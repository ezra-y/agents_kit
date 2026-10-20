import argparse
import csv
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package_assets(csv_path, assets_dir, output, media_columns):
    csv_path = Path(csv_path).resolve(strict=True)
    assets_dir = Path(assets_dir).resolve(strict=True)
    output = Path(output).absolute()
    if output.exists():
        raise FileExistsError(f"目标文件已存在：{output}")

    with csv_path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        missing_columns = set(media_columns) - set(headers)
        if missing_columns:
            raise ValueError(f"CSV 缺少素材列：{sorted(missing_columns)}")
        rows = list(reader)

    files = {csv_path.name: csv_path}
    references = 0
    for line_number, row in enumerate(rows, start=2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"CSV 第 {line_number} 行的列数与表头不同")
        for column in media_columns:
            name = row[column].strip()
            if not name:
                continue
            if Path(name).name != name or "\\" in name:
                raise ValueError(
                    f"素材单元格需要单个文件名：第 {line_number} 行，{column}"
                )
            asset = (assets_dir / name).resolve(strict=True)
            if not asset.is_file() or asset.stat().st_size == 0:
                raise ValueError(f"素材为空或不是文件：{asset}")
            if name == csv_path.name:
                raise ValueError(f"素材与导入表同名：{name}")
            files[name] = asset
            references += 1

    if not references:
        raise ValueError("CSV 没有引用任何素材")

    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "x", compression=ZIP_DEFLATED) as archive:
        for name, file in files.items():
            archive.write(file, arcname=name)

    with ZipFile(output) as archive:
        sizes = {item.filename: item.file_size for item in archive.infolist()}
    expected = {name: file.stat().st_size for name, file in files.items()}
    if sizes != expected:
        raise ValueError("压缩包内文件列表或大小与源文件不一致")

    return {
        "output": str(output),
        "csv_rows": len(rows),
        "media_references": references,
        "media_files": len(files) - 1,
        "files": list(files),
        "bytes": output.stat().st_size,
    }


def main():
    parser = argparse.ArgumentParser(
        description="将广告导入 CSV 和引用素材打包到一个 ZIP"
    )
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--media-column", action="append")
    args = parser.parse_args()
    columns = args.media_column or ["Media file name", "Thumbnail file name"]
    result = package_assets(args.csv, args.assets_dir, args.output, columns)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
