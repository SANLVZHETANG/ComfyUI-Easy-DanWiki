"""
Danbooru bilingual prompt autocomplete extension.

Pure front-end extension: registers a web directory and loads the
backend routes (image serving + status) from dbtags_server.
"""

import importlib.util
import os
import sys

from . import dbtags_server

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
