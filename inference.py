from __future__ import annotations

import sys
import traceback

from run_inference import main


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"inference.py failed: {exc}", file=sys.stderr)
        traceback.print_exc()
        raise SystemExit(1) from exc
