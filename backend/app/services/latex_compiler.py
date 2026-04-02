import asyncio
import base64
import mimetypes
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional


async def compile_latex(
    content: str,
    output_format: str = "pdf",
    *,
    entry_path: str = "document.tex",
    file_tree: Optional[dict[str, dict[str, str]]] = None,
) -> dict:
    output_format = (output_format or "pdf").lower()
    try:
        command = _resolve_command(output_format, entry_path)
    except ValueError as exc:
        return {
            "success": False,
            "pdf_base64": None,
            "file_base64": None,
            "file_name": None,
            "mime_type": None,
            "output_format": output_format,
            "log": str(exc),
        }

    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        tex_file = root / entry_path
        tex_file.parent.mkdir(parents=True, exist_ok=True)
        tex_file.write_text(content, encoding="utf-8")
        if file_tree:
            _materialize_file_tree(root, file_tree, skip_path=entry_path)

        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=tmpdir,
            )

            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
            except asyncio.TimeoutError:
                proc.kill()
                return {
                    "success": False,
                    "pdf_base64": None,
                    "file_base64": None,
                    "file_name": None,
                    "mime_type": None,
                    "output_format": output_format,
                    "log": "Compilation timed out after 60 seconds.",
                }

            log = stdout.decode("utf-8", errors="replace")
            output_file = root / f"{Path(entry_path).stem}.{output_format}"

            if output_file.exists():
                file_bytes = output_file.read_bytes()
                file_b64 = base64.b64encode(file_bytes).decode("utf-8")
                mime_type = mimetypes.guess_type(output_file.name)[0] or _default_mime_type(output_format)
                return {
                    "success": True,
                    "pdf_base64": file_b64 if output_format == "pdf" else None,
                    "file_base64": file_b64,
                    "file_name": output_file.name,
                    "mime_type": mime_type,
                    "output_format": output_format,
                    "log": log,
                }
            return {
                "success": False,
                "pdf_base64": None,
                "file_base64": None,
                "file_name": None,
                "mime_type": None,
                "output_format": output_format,
                "log": log,
            }
        except Exception as exc:
            return {
                "success": False,
                "pdf_base64": None,
                "file_base64": None,
                "file_name": None,
                "mime_type": None,
                "output_format": output_format,
                "log": str(exc),
            }


_MACTEX_BIN = "/Library/TeX/texbin"


def _find_compiler() -> Optional[str]:
    search_path = os.environ.get("PATH", "") + os.pathsep + _MACTEX_BIN
    for cmd in ("pdflatex", "xelatex", "lualatex", "tectonic"):
        found = shutil.which(cmd, path=search_path)
        if found:
            return found
    return None


def _find_command(*candidates: str) -> Optional[str]:
    search_path = os.environ.get("PATH", "") + os.pathsep + _MACTEX_BIN
    for cmd in candidates:
        found = shutil.which(cmd, path=search_path)
        if found:
            return found
    return None


def _resolve_command(output_format: str, entry_path: str) -> list[str]:
    stem = Path(entry_path).stem
    if output_format == "pdf":
        compiler = _find_compiler()
        if not compiler:
            raise ValueError(
                "No LaTeX compiler found. Please install TeX Live or MiKTeX.\n"
                "On macOS: brew install --cask mactex-no-gui\n"
                "On Ubuntu: apt-get install texlive-full\n"
                "Or install tectonic: cargo install tectonic"
            )
        if os.path.basename(compiler) == "tectonic":
            return [compiler, entry_path]
        return [compiler, "-interaction=nonstopmode", "-halt-on-error", entry_path]

    if output_format == "dvi":
        compiler = _find_command("latex")
        if not compiler:
            raise ValueError("DVI export requires the `latex` command from a TeX distribution.")
        return [compiler, "-interaction=nonstopmode", "-halt-on-error", entry_path]

    if output_format == "ps":
        latex = _find_command("latex")
        dvips = _find_command("dvips")
        if not latex or not dvips:
            raise ValueError("PostScript export requires both `latex` and `dvips` to be installed.")
        return [
            "/bin/sh",
            "-lc",
            f"'{latex}' -interaction=nonstopmode -halt-on-error '{entry_path}' && '{dvips}' '{stem}.dvi' -o '{stem}.ps'",
        ]

    raise ValueError(f"Unsupported output format: {output_format}")


def _default_mime_type(output_format: str) -> str:
    return {
        "pdf": "application/pdf",
        "dvi": "application/x-dvi",
        "ps": "application/postscript",
    }.get(output_format, "application/octet-stream")


def _materialize_file_tree(root: Path, file_tree: dict[str, dict[str, str]], *, skip_path: str):
    for rel_path, payload in file_tree.items():
        if rel_path == skip_path:
            continue
        target = root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        payload_type = payload.get("type")
        payload_content = payload.get("content", "")
        if payload_type == "text":
            target.write_text(payload_content, encoding="utf-8")
        elif payload_type == "binary" and payload_content:
            shutil.copyfile(payload_content, target)
