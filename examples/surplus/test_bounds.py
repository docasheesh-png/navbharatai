"""Offline sample validation using SDK-independent extracted functions."""
import ast
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def load_helpers():
    tree = ast.parse(Path(__file__).with_name("chat.py").read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.Assign))]
    scope = {"os": os, "json": json}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "chat.py", "exec"), scope)
    return scope


class BoundsSafetyTest(unittest.TestCase):
    def test_output_and_input_limits_without_sdk(self):
        scope = load_helpers()
        client = Mock()
        client.chat.completions.create.return_value = SimpleNamespace(
            model_extra={}, choices=[SimpleNamespace(message=SimpleNamespace(content="Hello"))])
        self.assertEqual(scope["chat"](client, "hi"), "Hello")
        self.assertEqual(client.chat.completions.create.call_args.kwargs["max_tokens"], 2048)
        client.reset_mock()
        for budget in (0, -1, 8193, 1.5, True):
            with self.assertRaises(RuntimeError):
                scope["chat"](client, "hi", max_tokens=budget)
        for message in ("", " ", "x" * 65537, None):
            with self.assertRaises(RuntimeError):
                scope["chat"](client, message)
        client.chat.completions.create.assert_not_called()

    def test_transport_hook_replaces_inherited_headers(self):
        scope = load_helpers()
        http_client = Mock()
        scope.update(httpx=SimpleNamespace(Client=http_client), OpenAI=Mock(),
                     _disable_sdk_logging=lambda: None)
        with patch.dict(os.environ, {"SURPLUS_API_KEY": "surplus-test",
                                    "SURPLUS_BASE_URL": scope["DEFAULT_BASE"]}):
            scope["create_client"]()
        hook = http_client.call_args.kwargs["event_hooks"]["request"][0]
        class URL:
            netloc = b"api.surplusintelligence.ai"
            def __str__(self):
                return scope["DEFAULT_BASE"] + "/chat/completions"
        request = SimpleNamespace(url=URL(), method="POST", content=b"{}",
                                  headers={"Authorization": "other-secret", "X-Secret": "private"})
        hook(request)
        self.assertEqual(request.headers["Authorization"], "Bearer surplus-test")
        self.assertNotIn("X-Secret", request.headers)
        request.method = "GET"
        with self.assertRaises(RuntimeError):
            hook(request)


if __name__ == "__main__":
    unittest.main()
