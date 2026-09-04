# -*- coding: utf-8 -*-
"""
Backend routes for the danbooru autocomplete extension.

READ-ONLY on the source dataset (danbooru-general-tags). Serves:
  GET /dbtags/status   -> json status (index info, manifest info, uptime)
  GET /dbtags/image    -> example image for a tag (whitelisted via manifest)
  GET /dbtags/fonts    -> font file names in the plugin fonts/ dir
  GET /dbtags/font     -> one font file (?name=, extension whitelisted)

Optional debug log (DEBUG=True) writes request traces to debug.log.
"""

import json
import os
import time

from aiohttp import web
from server import PromptServer

BASE = r"C:/Users/SANLVZHETANG/Desktop/todo/danbooru-general-tags"
MANIFEST_FILE = os.path.join(BASE, "manifest.json")
INDEX_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "web", "js", "data", "tags_index.json")
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
FONT_EXTS = (".ttf", ".otf", ".woff", ".woff2")
FONT_MIME = {
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}

DEBUG = True
DEBUG_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "debug.log")

_started = time.time()
_manifest = None
_index_meta = None


def _log(msg):
    if not DEBUG:
        return
    line = "[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    print("(dbtags) " + line, flush=True)
    try:
        with open(DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def _load_manifest():
    global _manifest
    if _manifest is None:
        if os.path.exists(MANIFEST_FILE):
            try:
                with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                    _manifest = json.load(f)
            except Exception as e:
                _log("manifest load failed: %r" % e)
                _manifest = {}
        else:
            _manifest = {}
    return _manifest


def _load_index_meta():
    global _index_meta
    if _index_meta is None:
        if os.path.exists(INDEX_FILE):
            try:
                with open(INDEX_FILE, "r", encoding="utf-8") as f:
                    idx = json.load(f)
                _index_meta = {
                    "version": idx.get("version"),
                    "count": idx.get("count"),
                    "source_total": idx.get("source_total"),
                    "built_at": idx.get("built_at"),
                }
            except Exception as e:
                _log("index load failed: %r" % e)
                _index_meta = {}
        else:
            _index_meta = {}
    return _index_meta


@PromptServer.instance.routes.get("/dbtags/status")
async def get_status(request):
    manifest = _load_manifest()
    meta = _load_index_meta()
    return web.json_response({
        "ok": True,
        "started": time.strftime("%Y-%m-%d %H:%M:%S",
                                  time.localtime(_started)),
        "debug": DEBUG,
        "index": meta,
        "manifest_entries": len(manifest),
        "fonts": _list_fonts(),
        "dataset_dir": BASE,
    })


@PromptServer.instance.routes.get("/dbtags/image")
async def get_image(request):
    tag = request.query.get("tag", "").strip()
    if not tag:
        return web.Response(status=400, text="missing tag")
    manifest = _load_manifest()
    entry = manifest.get(tag)
    path = None
    if isinstance(entry, dict):
        small = entry.get("small")
        large = entry.get("large")
        # small wins by default (thumbnails are lighter); large passed via
        # size=large when needed.
        size = request.query.get("size", "small")
        path = large if size == "large" else small
        if not path:
            path = small or large
    if not path:
        _log("image 404: tag=%s" % tag)
        return web.Response(status=404, text="no image for tag")
    full = os.path.abspath(os.path.join(BASE, path))
    if not full.startswith(os.path.abspath(BASE) + os.sep):
        _log("path escape blocked: tag=%s path=%s" % (tag, path))
        return web.Response(status=403, text="blocked")
    if not os.path.isfile(full):
        _log("image 404: tag=%s file missing=%s" % (tag, path))
        return web.Response(status=404, text="file missing")
    _log("image 200: tag=%s size=%s %s" % (tag, size, path))
    return web.FileResponse(full)


def _list_fonts():
    if not os.path.isdir(FONT_DIR):
        return []
    return sorted(n for n in os.listdir(FONT_DIR)
                  if n.lower().endswith(FONT_EXTS))


@PromptServer.instance.routes.get("/dbtags/fonts")
async def get_fonts(request):
    return web.json_response(_list_fonts())


@PromptServer.instance.routes.get("/dbtags/font")
async def get_font(request):
    name = request.query.get("name", "")
    base = os.path.basename(name)
    full = os.path.abspath(os.path.join(FONT_DIR, base))
    if (not base or not base.lower().endswith(FONT_EXTS)
            or not full.startswith(os.path.abspath(FONT_DIR) + os.sep)
            or not os.path.isfile(full)):
        _log("font 404: name=%s" % name)
        return web.Response(status=404, text="no such font")
    resp = web.FileResponse(full)
    resp.headers["Content-Type"] = FONT_MIME[os.path.splitext(base)[1].lower()]
    _log("font 200: %s" % base)
    return resp


def get_ext_dir(subpath=None):
    """Convenience for other modules (mirrors pysssss.get_ext_dir)."""
    dir = os.path.dirname(os.path.abspath(__file__))
    if subpath is not None:
        dir = os.path.join(dir, subpath)
    return os.path.abspath(dir)


if __name__ == "__main__":
    import sys
    _log("direct run: manifest=%d entries" % len(_load_manifest()))
    print(json.dumps(_load_index_meta(), ensure_ascii=False, indent=2))
    sys.exit(0)
