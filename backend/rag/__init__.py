"""Retrieval-augmented copilot over the cached PSI combustion records."""
import truststore

# Verify TLS (Hugging Face model download, Groq API) against the OS certificate store, so
# HTTPS works behind antivirus / corporate TLS inspection. Verification stays fully on.
truststore.inject_into_ssl()
