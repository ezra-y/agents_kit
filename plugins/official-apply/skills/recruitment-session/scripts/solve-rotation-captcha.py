#!/usr/bin/env python3
"""Estimate the clockwise rotation that aligns a captcha inner disk and outer ring."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from statistics import median

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit(
        "Pillow is required: run this script with a Python environment that provides PIL."
    ) from error


Rgb = tuple[float, float, float]
RgbaImage = Image.Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate the clockwise alignment angle for a two-ring captcha."
    )
    parser.add_argument("--inner", required=True, type=Path, help="Inner disk PNG")
    parser.add_argument("--outer", required=True, type=Path, help="Outer ring PNG")
    parser.add_argument(
        "--samples",
        type=int,
        default=360,
        help="Angular samples around the seam (default: 360)",
    )
    parser.add_argument(
        "--coarse-step",
        type=float,
        default=2.0,
        help="Coarse search step in degrees (default: 2)",
    )
    parser.add_argument(
        "--fine-step",
        type=float,
        default=0.1,
        help="Fine search step in degrees (default: 0.1)",
    )
    return parser.parse_args()


def load_rgba(path: Path) -> RgbaImage:
    if not path.is_file():
        raise ValueError(f"image_not_found: {path}")
    image = Image.open(path).convert("RGBA")
    if image.width < 40 or image.height < 40:
        raise ValueError(f"image_too_small: {path} is {image.width}x{image.height}")
    return image


def point(center: tuple[float, float], radius: float, angle: float) -> tuple[int, int]:
    return (
        round(center[0] + radius * math.cos(angle)),
        round(center[1] + radius * math.sin(angle)),
    )


def rgba_at(
    image: RgbaImage,
    center: tuple[float, float],
    radius: float,
    angle: float,
) -> tuple[int, int, int, int] | None:
    x, y = point(center, radius, angle)
    if x < 0 or y < 0 or x >= image.width or y >= image.height:
        return None
    return image.getpixel((x, y))


def detect_outer_hole_radius(
    image: RgbaImage,
    center: tuple[float, float],
) -> float:
    max_radius = int(min(image.width, image.height) / 2)
    first_opaque: list[int] = []
    for degree in range(360):
        angle = math.radians(degree)
        for radius in range(max_radius):
            pixel = rgba_at(image, center, radius, angle)
            if pixel is not None and pixel[3] >= 128:
                first_opaque.append(radius)
                break
    if len(first_opaque) < 180:
        raise ValueError("outer_ring_mask_unreadable")
    return float(median(first_opaque))


def ring_value(
    image: RgbaImage,
    center: tuple[float, float],
    radii: list[float],
    angle: float,
) -> Rgb | None:
    pixels = [
        pixel
        for radius in radii
        if (pixel := rgba_at(image, center, radius, angle)) is not None
        and pixel[3] >= 128
    ]
    if len(pixels) < 2:
        return None
    return tuple(
        sum(pixel[channel] for pixel in pixels) / len(pixels)
        for channel in range(3)
    )


def correlation(left: list[float], right: list[float]) -> float:
    if len(left) < 60 or len(left) != len(right):
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


def alignment_score(
    clockwise_degrees: float,
    inner: RgbaImage,
    outer_profile: list[Rgb | None],
    inner_center: tuple[float, float],
    inner_radii: list[float],
    sample_angles: list[float],
) -> float:
    rotation = math.radians(clockwise_degrees)
    inner_profile = [
        ring_value(inner, inner_center, inner_radii, angle - rotation)
        for angle in sample_angles
    ]
    scores: list[float] = []
    for channel in range(3):
        left: list[float] = []
        right: list[float] = []
        for inner_value, outer_value in zip(
            inner_profile, outer_profile, strict=True
        ):
            if inner_value is None or outer_value is None:
                continue
            left.append(inner_value[channel])
            right.append(outer_value[channel])
        scores.append(correlation(left, right))
    return sum(scores) / len(scores)


def angular_distance(left: float, right: float) -> float:
    delta = abs((left - right) % 360)
    return min(delta, 360 - delta)


def float_range(start: float, stop: float, step: float) -> list[float]:
    values: list[float] = []
    current = start
    while current <= stop + step / 2:
        values.append(current % 360)
        current += step
    return values


def solve(args: argparse.Namespace) -> dict[str, object]:
    if args.samples < 120:
        raise ValueError("samples_must_be_at_least_120")
    if args.coarse_step <= 0 or args.fine_step <= 0:
        raise ValueError("search_steps_must_be_positive")

    inner = load_rgba(args.inner)
    outer = load_rgba(args.outer)
    inner_center = ((inner.width - 1) / 2, (inner.height - 1) / 2)
    outer_center = ((outer.width - 1) / 2, (outer.height - 1) / 2)
    inner_radius = min(inner.width, inner.height) / 2
    outer_hole_radius = detect_outer_hole_radius(outer, outer_center)
    if abs(inner_radius - outer_hole_radius) > inner_radius * 0.2:
        raise ValueError(
            "ring_size_mismatch: inner disk and outer hole differ by more than 20%"
        )

    inner_radii = [inner_radius * ratio for ratio in (0.89, 0.93, 0.96)]
    outer_radii = [
        outer_hole_radius + inner_radius * ratio for ratio in (0.03, 0.07, 0.11)
    ]
    sample_angles = [
        2 * math.pi * index / args.samples for index in range(args.samples)
    ]
    outer_profile = [
        ring_value(outer, outer_center, outer_radii, angle)
        for angle in sample_angles
    ]

    coarse_angles = float_range(0, 360 - args.coarse_step, args.coarse_step)
    coarse_scores = [
        (
            alignment_score(
                angle,
                inner,
                outer_profile,
                inner_center,
                inner_radii,
                sample_angles,
            ),
            angle,
        )
        for angle in coarse_angles
    ]
    coarse_best_score, coarse_best_angle = max(coarse_scores)
    fine_angles = float_range(
        coarse_best_angle - args.coarse_step,
        coarse_best_angle + args.coarse_step,
        args.fine_step,
    )
    fine_scores = [
        (
            alignment_score(
                angle,
                inner,
                outer_profile,
                inner_center,
                inner_radii,
                sample_angles,
            ),
            angle,
        )
        for angle in fine_angles
    ]
    best_score, best_angle = max(fine_scores)
    separated_scores = [
        score
        for score, angle in coarse_scores
        if angular_distance(angle, best_angle) > 10
    ]
    runner_up_score = max(separated_scores) if separated_scores else -1.0
    score_gap = best_score - runner_up_score
    confidence = (
        "high"
        if best_score >= 0.45 and score_gap >= 0.08
        else "medium"
        if best_score >= 0.3 and score_gap >= 0.04
        else "low"
    )
    return {
        "clockwiseDegrees": round(best_angle % 360, 1),
        "confidence": confidence,
        "score": round(best_score, 4),
        "separatedRunnerUpScore": round(runner_up_score, 4),
        "scoreGap": round(score_gap, 4),
        "innerRadiusPx": round(inner_radius, 2),
        "outerHoleRadiusPx": round(outer_hole_radius, 2),
        "samples": args.samples,
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
