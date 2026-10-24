"""Standalone optional Python example: pip install openai. No call without --send."""
import argparse
import os
import logging
import json
import httpx
from openai import OpenAI, APIError, APIConnectionError, APITimeoutError

DEFAULT_BASE = "https://api.surplusintelligence.ai/v1"
MIN30_BASE = "https://api.surplusintelligence.ai/min30/v1"


def _disable_sdk_logging():
    """Suppress existing SDK children too; disabling a parent does not stop propagation."""
    namespaces = ("openai", "httpx", "httpcore")
    names = set(namespaces) | {
        name for name in logging.Logger.manager.loggerDict
        if any(name.startswith(namespace + ".") for namespace in namespaces)
    }
    for name in names:
        logger = logging.getLogger(name)
        logger.disabled = True
        logger.setLevel(logging.CRITICAL + 1)


def create_client():
    key = os.environ.get("SURPLUS_API_KEY", "").strip()
    base = os.environ.get("SURPLUS_BASE_URL", DEFAULT_BASE).strip().rstrip("/")
    if not key or key == "replace_with_your_surplus_api_key" or base not in (DEFAULT_BASE, MIN30_BASE):
        raise RuntimeError("Set SURPLUS_API_KEY and a supported HTTPS SURPLUS_BASE_URL.")
    # Do not enable SDK/HTTP debug logging: requests contain credentials and prompts.
    _disable_sdk_logging()
    def isolate_headers(request):
        if str(request.url) != base + "/chat/completions" or request.method != "POST":
            raise RuntimeError("Surplus request target is not allowed.")
        request.headers.clear()
        request.headers.update({
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Host": request.url.netloc.decode("ascii"),
            "Content-Length": str(len(request.content)),
        })

    return OpenAI(api_key=key, base_url=base, timeout=60.0, max_retries=0,
                  organization=None, project=None,
                  http_client=httpx.Client(follow_redirects=False, timeout=60.0,
                                          event_hooks={"request": [isolate_headers]}))


def chat(client, message, model=None, max_tokens=2048):
    if (type(max_tokens) is not int or not 1 <= max_tokens <= 8192 or
            not isinstance(message, str) or not message.strip()):
        raise RuntimeError("Use nonempty text and 1–8192 output tokens.")
    messages = [{"role": "user", "content": message}]
    if len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) > 65536:
        raise RuntimeError("Surplus input exceeds 64 KiB.")
    try:
        response = client.chat.completions.create(
            model=model or os.environ.get("SURPLUS_MODEL") or "deepseek-v4.1-flash",
            messages=messages,
            max_tokens=max_tokens,
            stream=False,
        )
        # HTTP 200 can still carry a provider error and billable usage.
        if "error" in (response.model_extra or {}):
            raise RuntimeError("Surplus could not complete the request; it may still have incurred cost.")
        text = response.choices[0].message.content if response.choices else None
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("Surplus returned no usable text response.")
        return text
    except APITimeoutError:
        raise RuntimeError("Surplus request timed out; no automatic retry was made.") from None
    except APIConnectionError:
        raise RuntimeError("Unable to connect to Surplus.") from None
    except APIError:
        raise RuntimeError("Surplus request failed. Check key, model access, and account limits.") from None


def smoke_test():
    with create_client() as client:
        print(chat(client, "Reply with a short hello."))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Make one potentially billable API request")
    args = parser.parse_args()
    if not args.send:
        parser.error("No request sent. Add --send only when you intend to make a billable request.")
    try:
        smoke_test()
    except RuntimeError as error:
        parser.exit(1, str(error) + "\n")
