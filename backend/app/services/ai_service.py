from __future__ import annotations
import json
from openai import AsyncOpenAI
from app.config import settings
from typing import AsyncIterator, Optional

client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

LATEX_SYSTEM_PROMPT = """You are an expert LaTeX assistant embedded in a collaborative LaTeX editor.
You understand LaTeX syntax deeply and help with:
- Writing and improving academic content
- Fixing LaTeX compilation errors
- Generating mathematical equations
- Converting plain text to proper LaTeX
- Suggesting appropriate LaTeX environments
- Academic writing improvements

Always return valid LaTeX when generating code. When fixing errors, explain briefly what was wrong.
Format responses using markdown where appropriate — use fenced code blocks with ```latex for code."""


def _parse_diff_json(raw: str) -> dict:
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"explanation": "AI returned invalid JSON", "changes": []}
    if "changes" not in result:
        result["changes"] = []
    for i, c in enumerate(result["changes"]):
        if "id" not in c:
            c["id"] = f"c{i+1}"
    return result


async def generate_text(prompt: str, document_context: str = "") -> AsyncIterator[str]:
    context_block = (
        f"\n\nCurrent document:\n```latex\n{document_context[:3000]}\n```"
        if document_context else ""
    )
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {"role": "user", "content": f"{prompt}{context_block}"},
        ],
        stream=True,
        max_tokens=2000,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def rewrite_text(text: str, style: str, document_context: str = "") -> AsyncIterator[str]:
    style_prompts = {
        "academic": "Rewrite the following text in a formal academic style suitable for a research paper.",
        "simplify": "Simplify the following text to be clearer and more concise.",
        "expand": "Expand the following text with more detail and supporting content.",
        "continue": "Continue writing from where the following text ends, maintaining the same style.",
        "summarize": "Summarize the following text, capturing the key ideas concisely.",
        "restructure": "Reorganize the following text into a more logical and readable structure.",
    }
    if style.startswith("translate:"):
        lang = style[len("translate:"):].strip() or "English"
        instruction = f"Translate the following text to {lang}, preserving all LaTeX commands and formatting exactly."
    else:
        instruction = style_prompts.get(style, f"Rewrite the following text ({style}).")
    context_block = (
        f"\n\nDocument context:\n```latex\n{document_context[:2000]}\n```"
        if document_context else ""
    )
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {"role": "user", "content": f"{instruction}\n\nText:\n{text}{context_block}"},
        ],
        stream=True,
        max_tokens=2000,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def fix_latex(code: str, error_log: str) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Fix the following LaTeX code that has compilation errors.\n\n"
                    f"LaTeX code:\n```latex\n{code}\n```\n\n"
                    f"Compilation error log:\n```\n{error_log}\n```\n\n"
                    f"Return ONLY the corrected LaTeX code, no explanation."
                ),
            },
        ],
        stream=True,
        max_tokens=4000,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def explain_error(error_log: str) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Explain this LaTeX compilation error in simple terms and suggest how to fix it:\n\n"
                    f"```\n{error_log}\n```"
                ),
            },
        ],
        stream=True,
        max_tokens=800,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def generate_equation(description: str) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Generate a LaTeX equation for: {description}\n\n"
                    f"Return only the LaTeX math code using appropriate environments "
                    f"(equation, align, etc.). Use a fenced ```latex code block."
                ),
            },
        ],
        stream=True,
        max_tokens=500,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def convert_to_latex(plain_text: str) -> AsyncIterator[str]:
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": LATEX_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Convert the following plain text to properly formatted LaTeX. "
                    f"Use appropriate LaTeX commands, environments, and formatting:\n\n{plain_text}"
                ),
            },
        ],
        stream=True,
        max_tokens=3000,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def suggest_changes(instruction: str, document_content: str, variation_request: str = "") -> dict:
    """Return structured JSON describing a set of diff hunks to apply to the document.

    Response schema:
    {
      "explanation": "Brief description of all changes",
      "changes": [
        {
          "id": "c1",
          "description": "What this hunk does",
          "old_text": "exact original text to find",
          "new_text": "replacement text"
        },
        ...
      ]
    }
    """
    system = (
        LATEX_SYSTEM_PROMPT
        + "\n\nWhen asked to modify a document, respond ONLY with a JSON object matching this schema:\n"
        + '{"explanation": "...", "changes": [{"id": "c1", "description": "...", "old_text": "...", "new_text": "..."}]}\n'
        + "Rules:\n"
        + "- old_text must be an exact verbatim substring of the document (copy-paste exact)\n"
        + "- new_text is the replacement\n"
        + "- Keep changes minimal and targeted\n"
        + "- If no change is needed, return {\"explanation\": \"No changes needed\", \"changes\": []}\n"
        + "- Output ONLY valid JSON, no markdown fences, no extra text"
    )

    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    f"Document:\n```latex\n{document_content[:8000]}\n```\n\n"
                    f"Instruction: {instruction}"
                    + (f"\nAdditional guidance for a different alternative: {variation_request}" if variation_request else "")
                ),
            },
        ],
        stream=False,
        max_tokens=4000,
        response_format={"type": "json_object"},
    )
    return _parse_diff_json(response.choices[0].message.content or "{}")


async def rewrite_diff(text: str, style: str, document_content: str, variation_request: str = "") -> dict:
    """Return a structured diff for simplify/summarize style rewrites."""
    target_rule = (
        "- The user provided a target snippet to rewrite\n"
        "- old_text must be an exact verbatim copy of that snippet as it appears in the document\n"
        "- new_text is the rewritten replacement for that exact snippet"
    ) if text else (
        "- Rewrite the document content directly\n"
        "- old_text must be an exact verbatim substring from the document\n"
        "- new_text is the rewritten replacement"
    )
    system = (
        LATEX_SYSTEM_PROMPT
        + "\n\nRewrite a LaTeX document and respond ONLY with JSON matching:\n"
        + '{"explanation":"...","changes":[{"id":"c1","description":"...","old_text":"...","new_text":"..."}]}\n'
        + "Rules:\n"
        + target_rule + "\n"
        + "- Preserve valid LaTeX syntax and commands\n"
        + "- Keep the change scoped to the rewritten portion\n"
        + "- Output ONLY valid JSON, no markdown fences"
    )
    prompt = (
        f"Style: {style}\n"
        + (f"Rewrite this exact text from the document:\n```latex\n{text}\n```\n" if text else "Rewrite the document content directly.\n")
        + (f"Make it meaningfully different in this way: {variation_request}\n" if variation_request else "")
        + f"\nDocument:\n```latex\n{document_content[:8000]}\n```"
    )
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        stream=False,
        max_tokens=5000,
        response_format={"type": "json_object"},
    )
    return _parse_diff_json(response.choices[0].message.content or "{}")


async def translate_diff(language: str, document_content: str, variation_request: str = "") -> dict:
    """Return a structured diff for translating the document to a target language."""
    system = (
        LATEX_SYSTEM_PROMPT
        + "\n\nTranslate the LaTeX document and respond ONLY with JSON matching:\n"
        + '{"explanation":"...","changes":[{"id":"c1","description":"...","old_text":"...","new_text":"..."}]}\n'
        + "Rules:\n"
        + "- old_text must be exact verbatim text from the document\n"
        + "- Split into paragraph/section chunks as separate changes for easier review\n"
        + "- Preserve ALL LaTeX commands, environments, math notation, and formatting\n"
        + "- Translate only human-readable text content between commands\n"
        + "- Output ONLY valid JSON, no markdown fences"
    )
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": (
                f"Translate this LaTeX document to {language}:\n\n```latex\n{document_content[:8000]}\n```"
                + (f"\n\nMake it meaningfully different in this way: {variation_request}" if variation_request else "")
            )},
        ],
        stream=False,
        max_tokens=6000,
        response_format={"type": "json_object"},
    )
    return _parse_diff_json(response.choices[0].message.content or "{}")


async def equation_diff(description: str, document_content: str, location: Optional[dict] = None, variation_request: str = "") -> dict:
    """Generate an equation and return a diff inserting it at the specified location."""
    if location:
        line = location.get("line")
        text = location.get("text", "")
        before_text = location.get("beforeText", "")
        after_text = location.get("afterText", "")
        if text.strip():
            location_rule = (
                f'- The user clicked line {line}, whose exact text is: "{text}"\n'
                f'- Insert the equation after that exact line\n'
                f'- old_text must be an exact verbatim copy of that clicked line text as it appears in the document\n'
                f'- new_text is old_text followed by the equation LaTeX on a new line'
            )
        else:
            location_rule = (
                f'- The user clicked empty line {line}\n'
                f'- The previous line text is: "{before_text}"\n'
                f'- The next line text is: "{after_text}"\n'
                f'- Preserve the empty-line insertion point exactly\n'
                f'- If next line text is non-empty, insert before it by setting old_text to that exact next line and new_text to the equation followed by a newline and then old_text\n'
                f'- Otherwise, if previous line text is non-empty, insert after it by setting old_text to that exact previous line and new_text to old_text followed by a newline and then the equation\n'
                f'- old_text must be an exact verbatim copy of whichever neighboring line you choose'
            )
    else:
        location_rule = (
        "- Find the best insertion point (before \\end{document} or after the last equation)\n"
        "- old_text must be a short exact verbatim string from the document"
        )
    system = (
        LATEX_SYSTEM_PROMPT
        + "\n\nGenerate a LaTeX equation and insert it. Respond ONLY with JSON:\n"
        + '{"explanation":"...","changes":[{"id":"c1","description":"...","old_text":"...","new_text":"..."}]}\n'
        + "Rules:\n"
        + location_rule + "\n"
        + "- Use appropriate environment: equation, align, or inline $...$ as needed\n"
        + "- Output ONLY valid JSON, no markdown fences"
    )
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": (
                f"{description}\n"
                + (f"\nCreate a meaningfully different alternative with this guidance: {variation_request}\n" if variation_request else "")
                + f"\nDocument:\n```latex\n{document_content[:4000]}\n```"
            )},
        ],
        stream=False,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )
    return _parse_diff_json(response.choices[0].message.content or "{}")
