"""
Export OmniParser-v2.0 icon detector to ONNX for Skrim browser extension.

Model source:
  Hugging Face: microsoft/OmniParser-v2.0
  Path: icon_detect/model.pt

License:
  AGPL-3.0 (GNU Affero General Public License v3.0)
  Note: Commercial or non-AGPL distributions must account for AGPL-3.0 copyleft obligations.

Graph details:
  Input:  images [1, 3, 1280, 1280] (CHW float32)
  Output: output0 [1, 5, 33600] (center_x, center_y, width, height, confidence)
  Single class: UI element / icon.
  Artifact size: ~77 MB (FP32 baseline).
"""

import os
import shutil
from huggingface_hub import hf_hub_download
from ultralytics import YOLO


def main():
    print("Downloading OmniParser-v2.0 icon_detect/model.pt...")
    try:
        model_path = hf_hub_download(
            repo_id="microsoft/OmniParser-v2.0",
            filename="icon_detect/model.pt"
        )
    except Exception:
        model_path = hf_hub_download(
            repo_id="microsoft/OmniParser-v2.0",
            filename="icon_detect/model.pt",
            local_files_only=True
        )

    print(f"Loading YOLO model from {model_path}...")
    model = YOLO(model_path)

    # Standard OmniParser export imgsz is 1280
    print("Exporting to ONNX...")
    exported_path = model.export(format="onnx", imgsz=1280)

    artifacts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")
    os.makedirs(artifacts_dir, exist_ok=True)

    dest_path = os.path.join(artifacts_dir, "omniparser-icon.onnx")

    print(f"Moving {exported_path} to {dest_path}...")
    shutil.move(exported_path, dest_path)

    size_mb = os.path.getsize(dest_path) / (1024 * 1024)
    print(f"Exported artifact size: {size_mb:.2f} MB")

    # Inspect ONNX shape using onnx module
    import onnx
    onnx_model = onnx.load(dest_path)
    print("Inputs:")
    for inp in onnx_model.graph.input:
        shape = [d.dim_value for d in inp.type.tensor_type.shape.dim]
        print(f"  {inp.name}: {shape}")
    print("Outputs:")
    for outp in onnx_model.graph.output:
        shape = [d.dim_value for d in outp.type.tensor_type.shape.dim]
        print(f"  {outp.name}: {shape}")

    print(f"Classes: {model.names}")


if __name__ == "__main__":
    main()
