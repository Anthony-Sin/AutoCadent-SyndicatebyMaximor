"""Pytest session configuration — hang diagnostics via stdlib faulthandler."""
import faulthandler
import os


def pytest_configure(config):
    seconds = int(os.environ.get("PYTEST_HANG_SECONDS", "240"))
    config._hang_handle = faulthandler.dump_traceback_later(seconds, exit=True)


def pytest_unconfigure(config):
    handle = getattr(config, "_hang_handle", None)
    if handle is not None:
        faulthandler.cancel_dump_traceback_later(handle)
