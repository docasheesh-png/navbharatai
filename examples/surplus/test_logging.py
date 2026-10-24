"""Offline logging regression; extracts the helper without importing optional SDKs."""
import ast
import io
import logging
from pathlib import Path
import unittest


class LoggingSafetyTest(unittest.TestCase):
    def test_existing_and_future_sdk_children_cannot_emit_debug(self):
        source = ast.parse(Path(__file__).with_name("chat.py").read_text())
        helper = next(node for node in source.body if isinstance(node, ast.FunctionDef)
                      and node.name == "_disable_sdk_logging")
        namespace = {"logging": logging}
        exec(compile(ast.Module(body=[helper], type_ignores=[]), "chat.py", "exec"), namespace)
        names = ("openai", "httpx", "httpcore", "openai._base_client",
                 "httpcore.connection", "openai.future_review_child")
        loggers = [logging.getLogger(name) for name in names[:-1]]
        saved = [(logger, logger.level, logger.disabled) for logger in loggers]
        root = logging.getLogger()
        previous_level = root.level
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        try:
            logging.getLogger("openai._base_client").setLevel(logging.DEBUG)
            logging.getLogger("httpcore.connection").setLevel(logging.DEBUG)
            namespace["_disable_sdk_logging"]()
            for name in names:
                logging.getLogger(name).debug("private request body")
            self.assertEqual(stream.getvalue(), "")
        finally:
            root.removeHandler(handler)
            root.setLevel(previous_level)
            for logger, level, disabled in saved:
                logger.setLevel(level)
                logger.disabled = disabled
            logging.Logger.manager.loggerDict.pop(names[-1], None)


if __name__ == "__main__":
    unittest.main()
