# NASA-HACK GNC & AI Guidance Subsystem
def __getattr__(name: str):
    if name in ("GNCInferenceEngine", "gnc_engine"):
        from .evaluate import GNCInferenceEngine, gnc_engine
        globals()["GNCInferenceEngine"] = GNCInferenceEngine
        globals()["gnc_engine"] = gnc_engine
        return globals()[name]
    if name in ("PPOAgent", "NumpyPPOPolicy"):
        from .ppo_agent import PPOAgent, NumpyPPOPolicy
        globals()["PPOAgent"] = PPOAgent
        globals()["NumpyPPOPolicy"] = NumpyPPOPolicy
        return globals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["PPOAgent", "NumpyPPOPolicy", "GNCInferenceEngine", "gnc_engine"]
