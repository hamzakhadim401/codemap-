"""
Stage 4 - ML Model Introspection

Hooks into PyTorch (and optionally TensorFlow) models during a real
forward/backward pass to capture:
  - Layer shapes (input/output tensor dimensions)
  - Parameter counts per layer
  - Activation statistics (mean, std, sparsity)
  - Gradient norms per layer (after backward)
  - Attention weight patterns (for transformer layers)

Output is a list of layer records that graph_builder.py merges into the
unified graph: each layer becomes a node with type="ml_layer", and the
sequential flow becomes "calls" edges so the existing D3 visualizer renders
them without changes.

Usage (from Python):
    from engine.ml_introspect import introspect_pytorch, to_ml_graph_json

    records = introspect_pytorch(model, sample_input)
    data = to_ml_graph_json(records, model_name="MyTransformer")

Graceful degradation: if torch is not importable the module loads fine;
introspect_pytorch raises ImportError with a clear message.

Confidential mode: no weights or activations are stored verbatim --
only aggregate statistics (mean, std, sparsity ratio, norm).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Layer record schema
# ---------------------------------------------------------------------------

def _empty_record(name: str, layer_type: str) -> Dict:
    return {
        "name":        name,
        "layer_type":  layer_type,   # e.g. "Linear", "Conv2d", "MultiheadAttention"
        "param_count": 0,
        "input_shape":  None,        # list of ints, set during forward hook
        "output_shape": None,
        "act_mean":     None,        # activation statistics (forward pass)
        "act_std":      None,
        "act_sparsity": None,        # fraction of near-zero activations
        "grad_norm":    None,        # L2 norm of .weight.grad (backward pass)
        "attn_pattern": None,        # "uniform"|"peaked"|"diagonal" for attention layers
    }


# ---------------------------------------------------------------------------
# PyTorch introspection
# ---------------------------------------------------------------------------

def introspect_pytorch(
    model,
    sample_input,
    *,
    run_backward: bool = True,
    confidential: bool = False,
) -> List[Dict]:
    """
    Run one forward (and optionally backward) pass through a PyTorch model
    with sys.settrace-style hooks, capturing structural and statistical data.

    model        : nn.Module
    sample_input : a tensor or tuple of tensors accepted by model.forward()
    run_backward : if True, call .backward() on a scalar loss derived from
                   the output so gradient norms are captured
    confidential : if True, activation values are summarised but never stored
                   (this is always the case -- only statistics are kept)

    Returns a list of layer records, one per named child module.
    """
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        raise ImportError(
            "PyTorch is required for ML introspection. "
            "Install it with: pip install torch"
        )

    records: Dict[str, Dict] = {}
    hooks = []

    def _param_count(module) -> int:
        return sum(p.numel() for p in module.parameters())

    def _act_stats(tensor) -> tuple:
        """Return (mean, std, sparsity) as plain floats. Never stores raw values."""
        try:
            t = tensor.detach().float()
            mean = float(t.mean())
            std  = float(t.std()) if t.numel() > 1 else 0.0
            sparsity = float((t.abs() < 1e-6).float().mean())
            return mean, std, sparsity
        except Exception:
            return None, None, None

    def _attn_pattern(attn_weights) -> Optional[str]:
        """Classify attention weight distribution coarsely."""
        try:
            w = attn_weights.detach().float()
            # Average across batch and heads if present
            while w.dim() > 2:
                w = w.mean(0)
            # Entropy as uniformity measure
            w = w.clamp(min=1e-9)
            entropy = float(-(w * w.log()).sum(-1).mean())
            max_entropy = math.log(w.shape[-1]) if w.shape[-1] > 1 else 1.0
            ratio = entropy / max_entropy if max_entropy > 0 else 0.0
            if ratio > 0.85:
                return "uniform"
            diag = float(w.diagonal().mean()) if w.shape[0] == w.shape[1] else 0.0
            if diag > 0.4:
                return "diagonal"
            return "peaked"
        except Exception:
            return None

    def _make_forward_hook(name: str):
        def hook(module, inp, out):
            r = records.setdefault(name, _empty_record(name, type(module).__name__))
            r["param_count"] = _param_count(module)
            # Input shape: first tensor in inp tuple
            for x in (inp if isinstance(inp, (list, tuple)) else [inp]):
                if hasattr(x, "shape"):
                    r["input_shape"] = list(x.shape)
                    break
            # Output shape
            out_tensor = out[0] if isinstance(out, (list, tuple)) else out
            if hasattr(out_tensor, "shape"):
                r["output_shape"] = list(out_tensor.shape)
                r["act_mean"], r["act_std"], r["act_sparsity"] = _act_stats(out_tensor)
            # Attention pattern detection
            if isinstance(out, tuple) and len(out) >= 2:
                maybe_attn = out[1]
                if hasattr(maybe_attn, "shape") and maybe_attn.dim() >= 2:
                    r["attn_pattern"] = _attn_pattern(maybe_attn)
        return hook

    def _make_backward_hook(name: str):
        def hook(module, grad_in, grad_out):
            r = records.setdefault(name, _empty_record(name, type(module).__name__))
            try:
                if hasattr(module, "weight") and module.weight is not None \
                        and module.weight.grad is not None:
                    r["grad_norm"] = float(module.weight.grad.norm())
            except Exception:
                pass
        return hook

    # Register hooks on all named child modules (non-recursive children only
    # gives one level; use named_modules() for full depth)
    for name, module in model.named_modules():
        if name == "":
            continue  # skip the root module itself
        hooks.append(module.register_forward_hook(_make_forward_hook(name)))
        hooks.append(module.register_full_backward_hook(_make_backward_hook(name)))

    try:
        import torch
        model.eval()
        inputs = sample_input if isinstance(sample_input, tuple) else (sample_input,)
        with torch.set_grad_enabled(run_backward):
            output = model(*inputs)
            if run_backward:
                # Derive a scalar loss so .backward() is valid
                out_tensor = output[0] if isinstance(output, (list, tuple)) else output
                if hasattr(out_tensor, "mean"):
                    out_tensor.mean().backward()
    finally:
        for h in hooks:
            h.remove()

    return list(records.values())


# ---------------------------------------------------------------------------
# Convert layer records -> unified graph JSON
# ---------------------------------------------------------------------------

def to_ml_graph_json(records: List[Dict], model_name: str = "model") -> Dict:
    """
    Convert layer records from introspect_pytorch() into the same
    {nodes, edges} schema that graph_builder.to_json() produces so the
    visualizer renders ML layers without any changes.

    Nodes get type="ml_layer" (a new type alongside module/class/function).
    Edges are sequential "calls" edges representing the forward-pass data flow.
    """
    if not records:
        return {"nodes": [], "edges": []}

    nodes = []
    edges = []

    root_id = f"ml_model:{model_name}"
    nodes.append({
        "id":          root_id,
        "type":        "ml_model",
        "name":        model_name,
        "file":        "",
        "line":        0,
        "loc":         0,
        "blast_radius": len(records),
        "param_count": sum(r.get("param_count", 0) for r in records),
    })

    prev_id = root_id
    for r in records:
        nid = f"ml_layer:{model_name}.{r['name']}"
        node = {
            "id":          nid,
            "type":        "ml_layer",
            "name":        r["name"].split(".")[-1],   # leaf name for display
            "file":        "",
            "line":        0,
            "loc":         0,
            "blast_radius": 0,
            # ML-specific fields (ignored by current visualizer, available for future)
            "layer_type":  r["layer_type"],
            "param_count": r["param_count"],
            "input_shape":  r["input_shape"],
            "output_shape": r["output_shape"],
        }
        # Only attach activation stats if they exist (skipped for non-tensor outputs)
        if r["act_mean"] is not None:
            node["act_mean"]     = round(r["act_mean"], 4)
            node["act_std"]      = round(r["act_std"],  4)
            node["act_sparsity"] = round(r["act_sparsity"], 4)
        if r["grad_norm"] is not None:
            node["grad_norm"] = round(r["grad_norm"], 4)
        if r["attn_pattern"] is not None:
            node["attn_pattern"] = r["attn_pattern"]
        nodes.append(node)

        edges.append({"source": prev_id, "target": nid, "type": "calls"})
        prev_id = nid

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# TensorFlow / Keras (optional, graceful degradation)
# ---------------------------------------------------------------------------

def introspect_keras(model, sample_input, *, confidential: bool = False) -> List[Dict]:
    """
    Keras/TF equivalent of introspect_pytorch(). Uses model.predict() with a
    Model that outputs every layer's activation.

    Requires tensorflow >= 2.x. Raises ImportError if not installed.
    """
    try:
        import tensorflow as tf
    except ImportError:
        raise ImportError(
            "TensorFlow is required for Keras ML introspection. "
            "Install it with: pip install tensorflow"
        )

    records = []
    import numpy as np

    for layer in model.layers:
        r = _empty_record(layer.name, type(layer).__name__)
        r["param_count"] = int(layer.count_params())
        if hasattr(layer, "input_shape"):
            try:
                r["input_shape"] = list(layer.input_shape)
            except Exception:
                pass
        if hasattr(layer, "output_shape"):
            try:
                r["output_shape"] = list(layer.output_shape)
            except Exception:
                pass

        # Build sub-model up to this layer and run a forward pass
        try:
            sub = tf.keras.Model(inputs=model.input, outputs=layer.output)
            out = sub.predict(sample_input, verbose=0)
            arr = np.array(out, dtype=np.float32).ravel()
            if arr.size > 0:
                r["act_mean"]     = float(arr.mean())
                r["act_std"]      = float(arr.std())
                r["act_sparsity"] = float((np.abs(arr) < 1e-6).mean())
        except Exception:
            pass

        records.append(r)

    return records
