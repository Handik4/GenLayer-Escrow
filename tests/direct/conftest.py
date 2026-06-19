"""Direct-mode test setup.

Two environment quirks are handled here so the suite runs deterministically on
this machine's Python 3.14 venv:

1. An empty ``genlayer`` 0.0.1 stub used to shadow the real GenVM SDK. It has
   been uninstalled, but we still purge any pre-imported ``genlayer`` module at
   collection time as a safety net.

2. The direct runner removes the extracted-SDK path from ``sys.path`` after each
   deploy. If the path is missing when an address fixture runs,
   ``create_address`` silently falls back to raw bytes (instead of an
   ``Address``), which then fails to parse. The autouse fixture below
   re-establishes the SDK path before every test.
"""

import sys

import pytest
from gltest.direct.sdk_loader import setup_sdk_paths


def _purge_genlayer():
    for _m in [m for m in list(sys.modules) if m == "genlayer" or m.startswith("genlayer.")]:
        del sys.modules[_m]


# Initial setup at collection time.
_purge_genlayer()
setup_sdk_paths()


@pytest.fixture(autouse=True)
def _ensure_sdk_path():
    """Make sure the GenVM SDK is importable before each test's fixtures run."""
    setup_sdk_paths()
    yield
