# Retired provider testing bots

The AI Engines provider testing bots, throughput/batch panels and their exclusive
HTTP routes have been removed. Existing diagnostic records, billing holds and user
history are not deleted or refunded by this change. Shared provider adapters,
redaction, authentication and main-chat accounting remain in place.

Old clients calling retired diagnostic routes receive the ordinary missing-route
response. Do not replay an uncertain historical request through main chat.
