"""Upload a converted ONNX speech model folder to the Hugging Face Hub.

Used by .github/workflows/convert-speech-models.yml after the transformers.js
conversion script has produced a `models/<source-repo>` folder containing
config/tokenizer files plus an `onnx/` subfolder with quantized variants.

Requires the HF_TOKEN environment variable (write token authorized for the
target owner/org).
"""

import argparse
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

MODEL_CARD = """---
library_name: transformers.js
base_model: {source}
pipeline_tag: {pipeline_tag}
license: mit
tags:
  - onnx
  - philippines
  - philippine-languages
---

# {target_name}

ONNX export of [`{source}`](https://huggingface.co/{source}) for in-browser
inference with [Transformers.js](https://huggingface.co/docs/transformers.js)
(WebGPU / WASM). Converted with the transformers.js conversion script
(`python -m scripts.convert --quantize`), which also produces quantized
variants (fp16, q8, int8, uint8, q4, bnb4) under `onnx/`.

Used as the default {task_label} model in the
[Can I AI? speech benchmark](https://github.com/sapinsapin/webllm-assistant).

## Usage (Transformers.js)

```js
import {{ pipeline }} from "@huggingface/transformers";

const pipe = await pipeline("{pipeline_tag}", "{target}");
```
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--converted", required=True, help="Path to the converted model folder")
    parser.add_argument("--source", required=True, help="Source Hub repo id (PyTorch model)")
    parser.add_argument("--target", required=True, help="Target Hub repo id for the ONNX export")
    parser.add_argument(
        "--pipeline-tag",
        required=True,
        choices=["automatic-speech-recognition", "text-to-speech"],
    )
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("HF_TOKEN is not set — add it as a repository secret.", file=sys.stderr)
        return 1

    converted = Path(args.converted)
    onnx_files = sorted(p.name for p in converted.glob("onnx/*.onnx"))
    if not onnx_files:
        print(f"No ONNX files found under {converted}/onnx — conversion failed?", file=sys.stderr)
        return 1
    print(f"Uploading {len(onnx_files)} ONNX files: {onnx_files}")

    task_label = "ASR" if args.pipeline_tag == "automatic-speech-recognition" else "TTS"
    (converted / "README.md").write_text(
        MODEL_CARD.format(
            source=args.source,
            target=args.target,
            target_name=args.target.split("/")[-1],
            pipeline_tag=args.pipeline_tag,
            task_label=task_label,
        )
    )

    api = HfApi(token=token)
    api.create_repo(args.target, repo_type="model", exist_ok=True)
    api.upload_folder(
        folder_path=str(converted),
        repo_id=args.target,
        repo_type="model",
        commit_message=f"ONNX export of {args.source} for Transformers.js",
    )
    print(f"Uploaded to https://huggingface.co/{args.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
