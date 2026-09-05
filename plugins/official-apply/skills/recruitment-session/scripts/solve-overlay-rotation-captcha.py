#!/usr/bin/env python3
"""Align a rotated circular overlay with the same scene in a background image."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError as error:
    raise SystemExit("Pillow is required.") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate the clockwise angle for a circular overlay captcha."
    )
    parser.add_argument("--piece", required=True, type=Path)
    parser.add_argument("--background", required=True, type=Path)
    parser.add_argument("--center-x", type=float)
    parser.add_argument("--center-y", type=float)
    parser.add_argument("--coarse-step", type=float, default=2.0)
    parser.add_argument("--fine-step", type=float, default=0.1)
    return parser.parse_args()


def load(path: Path) -> Image.Image:
    if not path.is_file():
        raise ValueError(f"image_not_found: {path}")
    image = Image.open(path).convert("RGBA")
    if image.width < 40 or image.height < 40:
        raise ValueError(f"image_too_small: {path}")
    return image


def crop_target(
    background: Image.Image,
    size: tuple[int, int],
    center_x: float | None,
    center_y: float | None,
) -> Image.Image:
    cx = background.width / 2 if center_x is None else center_x
    cy = background.height / 2 if center_y is None else center_y
    left = round(cx - size[0] / 2)
    top = round(cy - size[1] / 2)
    right = left + size[0]
    bottom = top + size[1]
    if left < 0 or top < 0 or right > background.width or bottom > background.height:
        raise ValueError("overlay_crop_outside_background")
    return background.crop((left, top, right, bottom))


def feature(image: Image.Image) -> list[float]:
    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    gray_values = (
        gray.get_flattened_data()
        if hasattr(gray, "get_flattened_data")
        else gray.getdata()
    )
    edge_values = (
        edges.get_flattened_data()
        if hasattr(edges, "get_flattened_data")
        else edges.getdata()
    )
    return [
        float(gray_value) * 0.35 + float(edge_value) * 0.65
        for gray_value, edge_value in zip(gray_values, edge_values, strict=True)
    ]


def mask_indices(piece: Image.Image) -> list[int]:
    alpha = piece.getchannel("A")
    cx = (piece.width - 1) / 2
    cy = (piece.height - 1) / 2
    radius = min(piece.width, piece.height) / 2
    inner = radius * 0.12
    outer = radius * 0.62
    indices: list[int] = []
    for y in range(piece.height):
        for x in range(piece.width):
            distance = math.hypot(x - cx, y - cy)
            if inner <= distance <= outer and alpha.getpixel((x, y)) >= 220:
                indices.append(y * piece.width + x)
    if len(indices) < 1000:
        raise ValueError("overlay_mask_unreadable")
    return indices


def correlation(left: list[float], right: list[float]) -> float:
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
        l_value * r_value
        for l_value, r_value in zip(left_delta, right_delta, strict=True)
    ) / denominator


def score(
    piece: Image.Image,
    target_feature: list[float],
    indices: list[int],
    counter_clockwise_degrees: float,
) -> float:
    rotated = piece.rotate(
        counter_clockwise_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=False,
    )
    rotated_feature = feature(rotated)
    return correlation(
        [rotated_feature[index] for index in indices],
        [target_feature[index] for index in indices],
    )


def float_range(start: float, stop: float, step: float) -> list[float]:
    values: list[float] = []
    current = start
    while current <= stop + step / 2:
        values.append(current % 360)
        current += step
    return values


def angular_distance(left: float, right: float) -> float:
    delta = abs((left - right) % 360)
    return min(delta, 360 - delta)


def solve(args: argparse.Namespace) -> dict[str, object]:
    if args.coarse_step <= 0 or args.fine_step <= 0:
        raise ValueError("search_steps_must_be_positive")
    piece = load(args.piece)
    background = load(args.background)
    target = crop_target(
        background,
        piece.size,
        args.center_x,
        args.center_y,
    )
    indices = mask_indices(piece)
    target_feature = feature(target)

    coarse = [
        (score(piece, target_feature, indices, angle), angle)
        for angle in float_range(0, 360 - args.coarse_step, args.coarse_step)
    ]
    coarse_score, coarse_angle = max(coarse)
    fine = [
        (score(piece, target_feature, indices, angle), angle)
        for angle in float_range(
            coarse_angle - args.coarse_step,
            coarse_angle + args.coarse_step,
            args.fine_step,
        )
    ]
    best_score, best_ccw_angle = max(fine)
    separated = [
        value
        for value, angle in coarse
        if angular_distance(angle, best_ccw_angle) > 10
    ]
    runner_up = max(separated) if separated else -1.0
    gap = best_score - runner_up
    clockwise_degrees = (-best_ccw_angle) % 360
    if math.isclose(clockwise_degrees, 360, abs_tol=args.fine_step):
        clockwise_degrees = 0.0
    confidence = (
        "high"
        if best_score >= 0.55 and gap >= 0.08
        else "medium"
        if best_score >= 0.35 and gap >= 0.04
        else "low"
    )
    return {
        "clockwiseDegrees": round(clockwise_degrees, 1),
        "counterClockwiseImageRotation": round(best_ccw_angle % 360, 1),
        "confidence": confidence,
        "score": round(best_score, 4),
        "separatedRunnerUpScore": round(runner_up, 4),
        "scoreGap": round(gap, 4),
        "pieceSize": list(piece.size),
        "targetCenter": [
            args.center_x if args.center_x is not None else background.width / 2,
            args.center_y if args.center_y is not None else background.height / 2,
        ],
    }


def main() -> int:
    try:
        result = solve(parse_args())
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
