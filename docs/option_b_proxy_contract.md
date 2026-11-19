# Option B: Managed Pay-per-Use Proxy API Contract

Dieses Dokument spezifiziert den HTTP/JSON-Vertrag zwischen dem Browser-Client (`ManagedProxyTransport` in `src/ai/transports/managedProxyTransport.ts`) und dem zukünftigen Option-B-Backend (z. B. Cloudflare Worker / Edge Gateway).

Durch die Abstraktion über `ITransportAdapter` kann die gesamte 5-Phasen-Pipeline ohne Codeänderung von **Option A (`DirectBrowserTransport` / BYOK)** auf **Option B (`ManagedProxyTransport`)** umgeschaltet werden.

---

## 1. Authentifizierung & Standard-Header

Jeder Request muss über HTTPS erfolgen und folgende Header setzen:

| Header | Pflicht | Beschreibung |
| :--- | :--- | :--- |
| `Authorization` | Ja | `Bearer <user_session_jwt>` |
| `Content-Type` | Ja (bei `POST`) | `application/json` |
| `X-BioBridge-Quote-Id` | Optional (empfohlen bei Pipeline-Runs) | Verknüpft den API-Call mit einer zuvor autorisierten Kostenschätzung (`quoteId`) für Budget-Cap-Prüfung. |

---

## 2. Verbindliche Sicherheits- & Epistemische Policy (No-Web-Search)

Das Backend **muss** vor der Weiterleitung an einen Upstream-LLM-Provider dieselbe Prüfung wie `assertNoExternalSearchTools()` erzwingen:

- Verbotene Keys (rekursiv, case-insensitiv): `googleSearch`, `google_search`, `google_search_retrieval`, `web_search`, `web_search_preview`, `web_search_options`, `search_grounding`, `grounding`, `tools`, `tool_choice`, `functions`, `function_call`, sowie Web-/Search-Einträge in `plugins`.
- Verbotener Suffix im `modelId`: `:online` (z. B. OpenRouter).
- Bei Verstoß antwortet das Gateway sofort mit HTTP **`403 Forbidden`** und `errorCode: "EXTERNAL_SEARCH_FORBIDDEN"`, ohne den Upstream-Provider aufzurufen.

---

## 3. Endpunkte

### 3.1 `POST /v1/billing/quote`
Meldet eine lokale `CostEstimate` aus `src/estimation/costEstimator.ts` vor Laufstart an und reserviert/prüft den maximalen Kreditrahmen.

**Request Body (`CostEstimate`):**
```json
{
  "phase1Vision": { "minUsd": 0.01, "expectedUsd": 0.02, "maxUsd": 0.04, "estimatedTokens": 5200 },
  "phase2Extract": { "minUsd": 0.04, "expectedUsd": 0.07, "maxUsd": 0.12, "estimatedTokens": 48000 },
  "phase3Cross": { "minUsd": 0.02, "expectedUsd": 0.04, "maxUsd": 0.08, "estimatedTokens": 18000 },
  "phase4Critic": { "minUsd": 0.03, "expectedUsd": 0.05, "maxUsd": 0.09, "estimatedTokens": 24000 },
  "total": { "minUsd": 0.10, "expectedUsd": 0.18, "maxUsd": 0.33, "estimatedTokens": 95200 },
  "cachedDocumentIds": [],
  "visionPageCount": 4,
  "estimatedDurationSec": { "min": 25, "expected": 45, "max": 85 },
  "usdToEurRate": 0.92,
  "computedAt": "2026-11-19T18:00:00.000Z"
}
```

**Response `200 OK`:**
```json
{
  "quoteId": "qt_01JD4Z8Y7E...",
  "maxChargeUsd": 0.33
}
```

---

### 3.2 `GET /v1/billing/balance`
Liefert den aktuellen Guthabenstand des Nutzerkontos.

**Response `200 OK`:**
```json
{
  "creditsUsd": 12.45,
  "currency": "USD"
}
```

---

### 3.3 `POST /v1/ai/completions`
Führt eine normierte Chat-/Completion-Anfrage (optional multimodal mit Base64-Bildern) über die serverseitig hinterlegten Provider-Keys aus.

**Request Body (`NormalizedCompletionRequest`):**
```json
{
  "provider": "gemini",
  "modelId": "gemini-2.5-flash",
  "role": "extraction",
  "messages": [
    { "role": "system", "content": "..." },
    {
      "role": "user",
      "content": "...",
      "images": [{ "mimeType": "image/png", "dataBase64": "..." }]
    }
  ],
  "temperature": 0.2,
  "maxTokens": 4096,
  "responseFormat": {
    "type": "json_schema",
    "schemaName": "BioExtractionResult",
    "jsonSchema": { "type": "object", "properties": {} }
  },
  "metadata": {
    "experimentId": "exp_123",
    "phase": "phase2_extract",
    "quoteId": "qt_01JD4Z8Y7E..."
  }
}
```

**Response `200 OK` (`NormalizedCompletionResponse`):**
```json
{
  "text": "{\"mechanisms\": [...]}",
  "provider": "gemini",
  "modelId": "gemini-2.5-flash",
  "finishReason": "STOP",
  "usage": {
    "inputTokens": 3120,
    "outputTokens": 840,
    "visionImages": 0,
    "costUsd": 0.00145,
    "serverSignedReceiptId": "rcpt_hmac_v1_9f8a2c..."
  }
}
```

---

### 3.4 `POST /v1/ai/embeddings`
Erzeugt Vektor-Embeddings für Phase 3A (`embedding-hybrid`).

**Request Body (`NormalizedEmbeddingRequest`):**
```json
{
  "provider": "openai",
  "modelId": "text-embedding-3-small",
  "texts": ["Turgor-driven actuation in Venus flytrap lobes..."],
  "metadata": {
    "experimentId": "exp_123",
    "quoteId": "qt_01JD4Z8Y7E..."
  }
}
```

**Response `200 OK` (`NormalizedEmbeddingResponse`):**
```json
{
  "embeddings": [[0.0123, -0.0441, "..."]],
  "provider": "openai",
  "modelId": "text-embedding-3-small",
  "usage": {
    "inputTokens": 18,
    "outputTokens": 0,
    "costUsd": 0.000001,
    "serverSignedReceiptId": "rcpt_hmac_v1_3c7b11..."
  }
}
```

---

## 4. Standardisierte Fehlercodes

Alle Fehlerantworten nutzen ein konsistentes JSON-Format:
```json
{
  "errorCode": "RATE_LIMITED",
  "message": "Upstream rate limit reached. Please retry.",
  "retryAfterSec": 5
}
```

| HTTP-Status | `errorCode` | Bedeutung im Client |
| :--- | :--- | :--- |
| `401` | `UNAUTHORIZED` | Session-Token ungültig oder abgelaufen (`AUTH_401`). |
| `402` | `INSUFFICIENT_CREDITS` | Guthaben erschöpft oder `maxChargeUsd` der Quote überschritten. |
| `403` | `EXTERNAL_SEARCH_FORBIDDEN` | Verbotene Web-Search-/Tool-Felder im Request erkannt. |
| `429` | `RATE_LIMITED` | Rate-Limit erreicht (`Retry-After` Header wird von `RateLimitQueue` ausgewertet). |
| `502` / `504` | `UPSTREAM_PROVIDER_ERROR` | Transienter Fehler des Upstream-LLM-Anbieters (automatischer Backoff-Retry). |
