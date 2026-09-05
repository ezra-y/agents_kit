#!/usr/bin/env python3
"""Locate the left edge of a darkened jigsaw gap in a captcha background."""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate a jigsaw gap x-coordinate from a captcha background PNG."
    )
    parser.add_argument("--background", required=True, type=Path)
    parser.add_argument(
        "--piece",
        type=Path,
        help="Optional transparent puzzle PNG from the captcha engine.",
    )
    parser.add_argument("--min-target-ratio", type=float, default=0.18)
    parser.add_argument("--min-gap-ratio", type=float, default=0.10)
    parser.add_argument("--max-gap-ratio", type=float, default=0.23)
    parser.add_argument(
        "--source-width-ratio",
        type=float,
        help="Known puzzle element width divided by background width.",
    )
    parser.add_argument(
        "--source-x-ratio",
        type=float,
        help="Known puzzle element left offset divided by background width.",
    )
    parser.add_argument(
        "--source-y-ratio",
        type=float,
        help="Known puzzle element top offset divided by background height.",
    )
    parser.add_argument(
        "--circle",
        action="store_true",
        help="Find a dark circular target aligned with the source circle.",
    )
    return parser.parse_args()


def region_mean(prefix: list[int], height: int, left: int, right: int) -> float:
    width = len(prefix) - 1
    left = min(width, max(0, left))
    right = min(width, max(0, right))
    area = max(1, (right - left) * height)
    return (prefix[right] - prefix[left]) / area


def correlation(left: list[float], right: list[float]) -> float:
    if len(left) < 200 or len(left) != len(right):
        return -1.0
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    left_delta = [value - left_mean for value in left]
    right_delta = [value - right_mean for value in right]
    denominator = math.sqrt(
        sum(value * value for value in left_delta)
        * sum(value * value for value in right_delta)
    )
    if denominator == 0:
        return -1.0
    return sum(
        left_value * right_value
        for left_value, right_value in zip(left_delta, right_delta, strict=True)
    ) / denominator


def solve_with_piece(
    background: Image.Image,
    piece_path: Path,
    min_target_ratio: float,
) -> dict[str, object]:
    if not piece_path.is_file():
        raise ValueError(f"piece_not_found: {piece_path}")
    piece = Image.open(piece_path).convert("RGBA")
    width, height = background.size
    piece_width, piece_height = piece.size
    if abs(piece_height - height) > 4 or piece_width >= width:
        raise ValueError(
            f"piece_size_mismatch: background={width}x{height}, "
            f"piece={piece_width}x{piece_height}"
        )

    mask_points: list[tuple[int, int, float]] = []
    for y in range(piece_height):
        for x in range(piece_width):
            red, green, blue, alpha = piece.getpixel((x, y))
            if alpha >= 160:
                mask_points.append((x, y, (red + green + blue) / 3))
    if len(mask_points) < 200:
        raise ValueError("piece_alpha_mask_too_small")

    background_rgb = background.convert("RGB")
    candidates: list[tuple[float, int, int]] = []
    min_target = max(0, round(width * min_target_ratio))
    for vertical_offset in range(-4, 5):
        shifted_points = [
            (x, y + vertical_offset, value)
            for x, y, value in mask_points
            if 0 <= y + vertical_offset < height
        ]
        piece_values = [value for _, _, value in shifted_points]
        for offset in range(min_target, width - piece_width + 1):
            background_values = [
                sum(background_rgb.getpixel((offset + x, y))) / 3
                for x, y, _ in shifted_points
            ]
            candidates.append(
                (
                    correlation(piece_values, background_values),
                    offset,
                    vertical_offset,
                )
            )
    candidates.sort(reverse=True)

    separated: list[tuple[float, int, int]] = []
    separation = max(10, round(piece_width * 0.15))
    for candidate in candidates:
        if all(abs(candidate[1] - other[1]) > separation for other in separated):
            separated.append(candidate)
        if len(separated) >= 5:
            break
    if not separated:
        raise ValueError("jigsaw_gap_not_found")

    best = separated[0]
    runner_up_score = separated[1][0] if len(separated) > 1 else -1.0
    score_gap = best[0] - runner_up_score
    confidence = (
        "high"
        if best[0] >= 0.25 and score_gap >= 0.1
        else "medium"
        if best[0] >= 0.15 and score_gap >= 0.05
        else "low"
    )
    return {
        "sourceX": 0,
        "sourceWidth": piece_width,
        "targetX": best[1],
        "distanceX": best[1],
        "verticalOffset": best[2],
        "gapWidth": piece_width,
        "confidence": confidence,
        "score": round(best[0], 4),
        "scoreGap": round(score_gap, 4),
        "gapAppearance": "transparent-piece-template",
        "imageWidth": width,
        "imageHeight": height,
        "method": "alpha-masked-template-correlation",
    }


def solve_circle_gap(
    background: Image.Image,
    source_x_ratio: float,
    source_y_ratio: float,
    source_width_ratio: float,
    min_target_ratio: float,
) -> dict[str, object]:
    image = background.convert("L")
    width, height = image.size
    source_x = round(width * source_x_ratio)
    source_y = round(height * source_y_ratio)
    source_width = round(width * source_width_ratio)
    radius = source_width / 2
    center_y = source_y + radius
    min_target = max(round(width * min_target_ratio), source_x + source_width + 12)
    candidates: list[tuple[float, int, float, float, float]] = []

    for left in range(min_target, width - source_width - 8):
        center_x = left + radius
        inside: list[int] = []
        ring: list[int] = []
        for y in range(max(0, round(center_y - radius * 1.35)), min(height, round(center_y + radius * 1.35))):
            for x in range(max(0, round(center_x - radius * 1.35)), min(width, round(center_x + radius * 1.35))):
                distance = math.hypot(x - center_x, y - center_y)
                if distance <= radius * 0.72:
                    inside.append(image.getpixel((x, y)))
                elif radius * 1.08 <= distance <= radius * 1.32:
                    ring.append(image.getpixel((x, y)))
        if len(inside) < 100 or len(ring) < 100:
            continue
        inside_mean = sum(inside) / len(inside)
        ring_mean = sum(ring) / len(ring)
        contrast = ring_mean - inside_mean
        inside_variance = sum((value - inside_mean) ** 2 for value in inside) / len(inside)
        boundary_deltas: list[int] = []
        for degrees in range(0, 360, 10):
            angle = math.radians(degrees)
            inner_x = round(center_x + math.cos(angle) * radius * 0.78)
            inner_y = round(center_y + math.sin(angle) * radius * 0.78)
            outer_x = round(center_x + math.cos(angle) * radius * 1.18)
            outer_y = round(center_y + math.sin(angle) * radius * 1.18)
            if (
                0 <= inner_x < width
                and 0 <= inner_y < height
                and 0 <= outer_x < width
                and 0 <= outer_y < height
            ):
                boundary_deltas.append(
                    image.getpixel((outer_x, outer_y))
                    - image.getpixel((inner_x, inner_y))
                )
        boundary_contrast = (
            sum(boundary_deltas) / len(boundary_deltas)
            if boundary_deltas
            else -255.0
        )
        score = (
            boundary_contrast
            + contrast * 0.35
            + (255 - inside_mean) * 0.7
            - math.sqrt(inside_variance) * 0.05
        )
        candidates.append(
            (score, left, contrast, inside_mean, boundary_contrast)
        )

    candidates.sort(reverse=True)
    separated: list[tuple[float, int, float, float]] = []
    separation = max(10, round(source_width * 0.6))
    for candidate in candidates:
        if all(abs(candidate[1] - other[1]) > separation for other in separated):
            separated.append(candidate)
        if len(separated) >= 5:
            break
    if not separated:
        raise ValueError("circle_gap_not_found")

    best = separated[0]
    runner_up = separated[1][0] if len(separated) > 1 else 0.0
    score_gap = best[0] - runner_up
    threshold = min(90, best[3] + max(8, best[2] * 0.5))
    refined_starts: list[int] = []
    best_center = best[1] + radius
    for y in range(
        max(0, round(center_y - radius * 0.35)),
        min(height, round(center_y + radius * 0.35) + 1),
    ):
        run_start: int | None = None
        for x in range(min_target, width):
            dark = image.getpixel((x, y)) <= threshold
            if dark and run_start is None:
                run_start = x
            if (not dark or x == width - 1) and run_start is not None:
                run_end = x if dark and x == width - 1 else x - 1
                run_width = run_end - run_start + 1
                run_center = (run_start + run_end) / 2
                if (
                    source_width * 0.65 <= run_width <= source_width * 1.4
                    and abs(run_center - best_center) <= source_width
                ):
                    refined_starts.append(run_start)
                run_start = None
    refined_left = (
        round(statistics.median(refined_starts))
        if len(refined_starts) >= 3
        else best[1]
    )
    confidence = (
        "high"
        if best[2] >= 25 and score_gap >= 8
        else "medium"
        if best[2] >= 15 and score_gap >= 4
        else "low"
    )
    return {
        "sourceX": source_x,
        "sourceWidth": source_width,
        "targetX": refined_left,
        "distanceX": refined_left - source_x,
        "gapWidth": source_width,
        "confidence": confidence,
        "score": round(best[0], 3),
        "scoreGap": round(score_gap, 3),
        "contrast": round(best[2], 3),
        "targetMean": round(best[3], 3),
        "boundaryContrast": round(best[4], 3),
        "refinedRows": len(refined_starts),
        "gapAppearance": "dark-circle",
        "imageWidth": width,
        "imageHeight": height,
        "method": "aligned-dark-circle-contrast",
    }


def solve(args: argparse.Namespace) -> dict[str, object]:
    if not args.background.is_file():
        raise ValueError(f"background_not_found: {args.background}")
    if not 0 < args.min_target_ratio < 0.8:
        raise ValueError("min_target_ratio_out_of_range")
    if not 0.03 <= args.min_gap_ratio < args.max_gap_ratio <= 0.4:
        raise ValueError("gap_ratio_out_of_range")
    if (
        args.source_width_ratio is not None
        and not 0.05 <= args.source_width_ratio <= 0.35
    ):
        raise ValueError("source_width_ratio_out_of_range")
    if (
        args.source_x_ratio is not None
        and not -0.05 <= args.source_x_ratio <= 0.3
    ):
        raise ValueError("source_x_ratio_out_of_range")
    if (args.source_x_ratio is None) != (args.source_width_ratio is None):
        raise ValueError("source_geometry_requires_x_and_width")
    if args.circle and args.source_y_ratio is None:
        raise ValueError("circle_requires_source_y")

    background = Image.open(args.background)
    if args.circle:
        return solve_circle_gap(
            background,
            args.source_x_ratio,
            args.source_y_ratio,
            args.source_width_ratio,
            args.min_target_ratio,
        )
    if args.piece is not None:
        return solve_with_piece(
            background,
            args.piece,
            args.min_target_ratio,
        )

    image = background.convert("L")
    width, height = image.size
    if width < 180 or height < 90:
        raise ValueError(f"background_too_small: {width}x{height}")

    y_start = max(5, round(height * 0.08))
    y_stop = min(height - 45, round(height * 0.72))
    sample_height = y_stop - y_start
    if sample_height < 35:
        raise ValueError("background_sample_region_too_small")

    column_sums = [
        sum(image.getpixel((x, y)) for y in range(y_start, y_stop))
        for x in range(width)
    ]
    prefix = [0]
    for value in column_sums:
        prefix.append(prefix[-1] + value)

    edge_scores = [0] * width
    for x in range(2, width - 2):
        edge_scores[x] = sum(
            abs(image.getpixel((x + 1, y)) - image.getpixel((x - 1, y)))
            for y in range(y_start, y_stop)
        )

    min_target = max(60, round(width * args.min_target_ratio))
    min_gap = max(32, round(width * args.min_gap_ratio))
    max_gap = min(round(width * args.max_gap_ratio), width - min_target - 1)
    contrast_weight = max(100.0, sample_height * 1.4)

    if args.source_width_ratio is None:
        source_min_gap = min_gap
        source_max_gap = max_gap
        source_candidates: list[tuple[int, int, int]] = []
        source_left_limit = min(min_target - min_gap, round(width * 0.12))
        for left in range(2, max(3, source_left_limit)):
            for gap_width in range(
                source_min_gap,
                min(source_max_gap, width - left - 1) + 1,
            ):
                right = left + gap_width
                source_candidates.append(
                    (edge_scores[left] + edge_scores[right], left, gap_width)
                )
        source_candidates.sort(reverse=True)
        if not source_candidates:
            raise ValueError("jigsaw_source_not_found")
        source = source_candidates[0]
    else:
        known_source_width = round(width * args.source_width_ratio)
        source_min_gap = max(min_gap, known_source_width - 12)
        source_max_gap = min(max_gap, known_source_width + 12)
        source = (
            0,
            round(width * args.source_x_ratio),
            known_source_width,
        )

    target_min_gap = max(min_gap, source[2] - 12)
    target_max_gap = min(max_gap, source[2] + 12)
    candidates: list[tuple[float, int, int, float, float]] = []
    for left in range(min_target, width - min_gap - 16):
        for gap_width in range(
            target_min_gap,
            min(target_max_gap, width - left - 16) + 1,
        ):
            right = left + gap_width
            inside = region_mean(prefix, sample_height, left + 4, right - 3)
            outside = (
                region_mean(prefix, sample_height, left - 16, left - 3)
                + region_mean(prefix, sample_height, right + 3, right + 16)
            ) / 2
            contrast_delta = outside - inside
            contrast = abs(contrast_delta)
            score = (
                edge_scores[left]
                + edge_scores[right]
                + contrast * contrast_weight
            )
            candidates.append(
                (score, left, gap_width, contrast, contrast_delta)
            )

    candidates.sort(reverse=True)
    separated: list[tuple[float, int, int, float, float]] = []
    separation = max(8, round(width * 0.02))
    for candidate in candidates:
        if all(abs(candidate[1] - other[1]) > separation for other in separated):
            separated.append(candidate)
        if len(separated) >= 5:
            break
    if not separated:
        raise ValueError("jigsaw_gap_not_found")

    best = separated[0]
    runner_up_score = separated[1][0] if len(separated) > 1 else 0.0
    score_ratio = best[0] / runner_up_score if runner_up_score > 0 else 99.0
    confidence = (
        "high"
        if score_ratio >= 1.3 and best[3] >= 5
        else "medium"
        if score_ratio >= 1.08 and best[3] >= 5
        else "low"
    )

    return {
        "sourceX": source[1],
        "sourceWidth": source[2],
        "targetX": best[1],
        "distanceX": best[1] - source[1],
        "gapWidth": best[2],
        "confidence": confidence,
        "score": round(best[0], 3),
        "scoreRatio": round(score_ratio, 3),
        "contrast": round(best[3], 3),
        "gapAppearance": "darker" if best[4] > 0 else "lighter",
        "imageWidth": width,
        "imageHeight": height,
        "method": "vertical-edge-pair-with-bidirectional-gap-contrast",
    }


def main() -> None:
    try:
        print(json.dumps(solve(parse_args()), ensure_ascii=True))
    except Exception as error:
        print(
            json.dumps(
                {"ok": False, "error": str(error)},
                ensure_ascii=True,
            )
        )
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
