from pathlib import Path

zh_root = Path("content/zh/docs")
en_root = Path("content/en/docs")

for zh_file in zh_root.rglob("*.md"):
    relative = zh_file.relative_to(zh_root)
    en_file = en_root / relative

    # 已有英文翻译或占位文件则跳过
    if en_file.exists():
        continue

    en_file.parent.mkdir(parents=True, exist_ok=True)

    url = "/zh/docs/" + relative.with_suffix("").as_posix() + "/"

    en_file.write_text(
        f"""---
title: "{relative.stem}"
draft: false
url: "/en/docs/{relative.with_suffix('').as_posix()}/"
---

<script>window.location.replace("{url}")</script>

[Read Chinese version]({url})
""",
        encoding="utf-8",
    )

    print(f"Created: {en_file}")