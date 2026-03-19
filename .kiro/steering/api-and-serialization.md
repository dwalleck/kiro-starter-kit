# API Design and Serialization

## Public API Stability
- Extend-only design: add new members, never remove or rename existing ones.
- Distinguish API compatibility (source/binary) from wire compatibility (serialized formats).
- New interface members must have default implementations.
- Never change the return type or parameter types of existing public methods.

## Wire Formats
- Prefer schema-based serialization (Protobuf, MessagePack) over reflection-based (Newtonsoft.Json).
- Use System.Text.Json with source generators for JSON scenarios — AOT-compatible, no reflection.
- Never embed .NET type names in serialized payloads (`TypeNameHandling.All` is banned).
- Use explicit discriminators for polymorphism (`[JsonDerivedType]`), not `$type`.
- Protobuf/MessagePack: never reuse field numbers. Reserve removed fields.

## System.Text.Json
- Always define a `JsonSerializerContext` with `[JsonSerializable]` for all serialized types.
- Configure `JsonSourceGenerationOptions` for naming policy and null handling.
- Register the context in ASP.NET Core via `ConfigureHttpJsonOptions`.

## Versioning
- Deploy deserializers before serializers when changing wire formats.
- Old code must safely ignore unknown fields (tolerant reader pattern).
- For Protobuf: adding new fields with new numbers is always safe. Changing field types is never safe.
