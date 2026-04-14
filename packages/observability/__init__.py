"""
packages/observability — OpenTelemetry hooks for Life++ Agent OS.

All cognitive, value flow, and trust events are traced.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def setup_tracing(service_name: Optional[str] = None) -> None:
    """
    Configure OpenTelemetry tracing for the Life++ Agent OS.

    In production: exports to OTLP collector (Jaeger, Tempo, etc.)
    In development: logs traces to console.
    """
    name = service_name or os.getenv("OTEL_SERVICE_NAME", "lifepp-agent-os")
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider()

        if endpoint:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
            exporter = OTLPSpanExporter(endpoint=endpoint)
            provider.add_span_processor(BatchSpanProcessor(exporter))

        trace.set_tracer_provider(provider)
        logger.info(
            "OpenTelemetry tracing initialised",
            extra={"service": name, "endpoint": endpoint or "none"},
        )
    except ImportError:
        logger.warning(
            "OpenTelemetry packages not installed — tracing disabled. "
            "Install opentelemetry-sdk to enable."
        )
