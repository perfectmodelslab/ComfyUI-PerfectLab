# -*- coding: utf-8 -*-
"""PerfectLab's own userdata write API.

The stock ComfyUI userdata routes are read-only on some installations
(this machine's 0.11.1 build answers 405 to POST and DELETE on
/api/userdata/{file} while the code on disk registers them -- whatever
the cause, the panel's custom libraries could never persist). PerfectLab
ships its own read/write/delete endpoints scoped to the same user
directory, built on the UserManager's own path validation, so the
panel's writes work on any build.

Registered under /perfectlab/userdata (and /api/perfectlab/userdata via
the automatic /api prefix mirror).
"""
import os

from aiohttp import web


def add_routes(routes, user_manager):
    @routes.get("/perfectlab/userdata")
    async def read_userdata(request):
        f = request.query.get("file", "")
        if not f:
            return web.Response(status=400, text="file query parameter required")
        path = user_manager.get_request_user_filepath(request, f, create_dir=False)
        if not path or not os.path.exists(path):
            return web.Response(status=404, text="not found")
        return web.FileResponse(path)

    @routes.post("/perfectlab/userdata")
    async def write_userdata(request):
        f = request.query.get("file", "")
        if not f:
            return web.Response(status=400, text="file query parameter required")
        path = user_manager.get_request_user_filepath(request, f, create_dir=True)
        if not path:
            return web.Response(status=403, text="path rejected")
        body = await request.read()
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(body)
        except OSError:
            return web.Response(status=400, text="invalid filename")
        return web.json_response(f)

    @routes.delete("/perfectlab/userdata")
    async def delete_userdata(request):
        f = request.query.get("file", "")
        if not f:
            return web.Response(status=400, text="file query parameter required")
        path = user_manager.get_request_user_filepath(request, f, create_dir=False)
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                return web.Response(status=400, text="could not remove")
        return web.json_response(f)
