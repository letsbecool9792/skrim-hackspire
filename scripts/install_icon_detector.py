"""
Installer wrapper to export and verify the OmniParser icon detector ONNX model.
"""

import os
import subprocess
import sys
from pathlib import Path


def main():
    repo_root = Path(__file__).resolve().parent.parent
    scripts_dir = repo_root / "scripts"
    artifact_path = scripts_dir / "artifacts" / "omniparser-icon.onnx"
    export_script = scripts_dir / "export_icon_detector.py"

    if artifact_path.is_file() and artifact_path.stat().st_size > 0:
        size_mb = artifact_path.stat().st_size / (1024 * 1024)
        print(f"[install_icon_detector] Artifact already exists: {artifact_path} ({size_mb:.2f} MB)")
        return 0

    # Determine Python executable: prefer sys.executable, or project venv if sys.executable lacks dependencies
    python_bin = sys.executable
    venv_bin = scripts_dir / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if venv_bin.is_file():
        try:
            subprocess.run(
                [python_bin, "-c", "import ultralytics, torch"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
        except Exception:
            python_bin = str(venv_bin)

    print(f"[install_icon_detector] Exporting icon detector using {python_bin}...")
    result = subprocess.run([python_bin, str(export_script)], cwd=str(repo_root))
    if result.returncode != 0:
        print(f"[install_icon_detector] Export failed with exit code {result.returncode}", file=sys.stderr)
        return result.returncode

    if not artifact_path.is_file() or artifact_path.stat().st_size == 0:
        print(f"[install_icon_detector] Expected artifact not found at {artifact_path}", file=sys.stderr)
        return 1

    size_mb = artifact_path.stat().st_size / (1024 * 1024)
    print(f"[install_icon_detector] Successfully verified {artifact_path} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
