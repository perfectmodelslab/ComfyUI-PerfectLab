from .perfectlab_studio import PerfectLabStudio

# PerfectLab Studio is the single node of the kit; the prompt composers
# live on as the engine library it calls into.

NODE_CLASS_MAPPINGS = {
    "PerfectLabStudio": PerfectLabStudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PerfectLabStudio": "PerfectLab Studio",
}


# ---- PerfectLab's own userdata write API --------------------------------
# some ComfyUI builds serve the stock userdata routes read-only (405 on
# POST/DELETE), which silently killed the panel's custom libraries. Our
# endpoints write through the UserManager's own validated paths.
try:
    from server import PromptServer
    from .server_routes import add_routes as _add_userdata_routes
    _add_userdata_routes(PromptServer.instance.routes,
                          PromptServer.instance.user_manager)
except Exception as e:  # a headless import or an older core -- degrade quietly
    print("PerfectLab: userdata routes not registered:", e)


WEB_DIRECTORY = "./web"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
