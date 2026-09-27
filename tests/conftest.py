import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="pt-test-")
os.environ["PT_MOCK"] = "1"
os.environ["PT_DATA_DIR"] = str(Path(_tmp) / "data")
os.environ["PT_CONFIG_DIR"] = str(Path(_tmp) / "config")
os.environ["PT_USB_ROOT"] = str(Path(_tmp) / "media")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
