#!/usr/bin/env python3
"""
PDF 转 DOC 脚本
支持将单个 PDF 文件或整个目录下的 PDF 文件转换为 DOCX 格式。
"""

import argparse
import sys
from pathlib import Path

try:
    from pdf2docx import Converter
except ImportError:
    print("错误：缺少依赖库，请运行以下命令安装：")
    print("  pip install pdf2docx")
    sys.exit(1)


def parse_pages(pages_str: str) -> list[int]:
    """
    将页码范围字符串解析为 0-based 页码列表。
    支持 '1,3-5,7' 这样的格式（用户输入为 1-based）。
    """
    result: list[int] = []
    for part in pages_str.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start_p = int(start_s.strip())
            end_p = int(end_s.strip())
            if start_p < 1 or end_p < start_p:
                raise ValueError(f"无效的页码范围：{part}")
            result.extend(range(start_p - 1, end_p))
        else:
            p = int(part)
            if p < 1:
                raise ValueError(f"页码必须大于 0：{part}")
            result.append(p - 1)
    return result


def convert_pdf_to_docx(
    pdf_path: Path,
    output_path: Path | None = None,
    pages: list[int] | None = None,
) -> Path:
    """将单个 PDF 文件转换为 DOCX 文件。

    pages: 0-based 页码列表，None 表示转换全部页面。
    """
    if output_path is None:
        output_path = pdf_path.with_suffix(".docx")

    if output_path.exists():
        print(f"  跳过（已存在）：{output_path}")
        return output_path

    print(f"  转换中：{pdf_path.name} -> {output_path.name}")
    cv = Converter(str(pdf_path))
    if pages is not None:
        cv.convert(str(output_path), pages=pages)
    else:
        cv.convert(str(output_path), start=0, end=None)
    cv.close()
    print(f"  完成：{output_path}")
    return output_path


def convert_directory(
    input_dir: Path,
    output_dir: Path | None = None,
    pages: list[int] | None = None,
) -> list[Path]:
    """转换目录下所有 PDF 文件。"""
    pdf_files = sorted(input_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"未在 {input_dir} 中找到 PDF 文件。")
        return []

    if output_dir is None:
        output_dir = input_dir

    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for pdf_file in pdf_files:
        out_path = output_dir / f"{pdf_file.stem}.docx"
        result = convert_pdf_to_docx(pdf_file, out_path, pages=pages)
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(description="PDF 转 DOC 转换工具")
    parser.add_argument(
        "input",
        type=str,
        help="输入的 PDF 文件路径或包含 PDF 文件的目录路径",
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="输出路径（文件或目录），不指定则自动生成",
    )
    parser.add_argument(
        "--pages",
        type=str,
        default=None,
        help="指定页码范围，如 '1,3-5,7'（默认转换全部页面）",
    )

    args = parser.parse_args()
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"错误：输入路径不存在：{input_path}")
        sys.exit(1)

    # 解析页码范围（用户输入为 1-based）
    pages: list[int] | None = None
    if args.pages:
        try:
            pages = parse_pages(args.pages)
            if not pages:
                print("错误：页码范围为空。")
                sys.exit(1)
        except ValueError as e:
            print(f"错误：页码格式无效：{e}")
            sys.exit(1)

    if input_path.is_file():
        if input_path.suffix.lower() != ".pdf":
            print(f"错误：输入文件不是 PDF 格式：{input_path}")
            sys.exit(1)

        output_path = Path(args.output) if args.output else None
        convert_pdf_to_docx(input_path, output_path, pages=pages)

    elif input_path.is_dir():
        output_dir = Path(args.output) if args.output else None
        results = convert_directory(input_path, output_dir, pages=pages)
        print(f"\n共转换 {len(results)} 个文件。")

    else:
        print(f"错误：无法识别的路径类型：{input_path}")
        sys.exit(1)


if __name__ == "__main__":
    main()
