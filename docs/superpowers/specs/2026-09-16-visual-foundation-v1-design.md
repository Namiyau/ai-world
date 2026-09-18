# Visual Foundation V1 design

## Scope

Stabilize first-person movement and improve only the existing environment rendering. World generation, water topology, roads, and character geometry remain unchanged.

## Player stability

`PlayerController` treats the collision coordinator's resolved position as authoritative. The controller derives its velocity from `finalCameraPosition - initialCameraPosition`, so blocked or grounded motion cannot re-inject a requested displacement on the next frame. A stationary grounded player has zero vertical glue velocity; a small downward stick velocity is used only while moving over terrain.

The player-avatar anchor shares the camera ellipsoid contract: its root is placed at the ellipsoid foot, including the ellipsoid offset. Unit coverage verifies the non-zero-offset case, and browser coverage samples a still player over several seconds.

## Lighting and sky

`Atmosphere` remains the single owner of lights, fog, sky, and shadow configuration. A camera-relative cascaded directional shadow map covers the nearby play area. Terrain and substantial scenery receive shadows. Only substantial nearby scenery is registered as a caster; grass, flowers, and other micro-detail remain excluded.

Ambient fill is reduced while sunlight is strengthened. The existing shader sky gains a low-cost drifting procedural cloud layer. Daytime fog is made less dense without removing distant atmospheric perspective.

## Verification

Unit tests validate collision displacement semantics and avatar foot placement. Browser acceptance samples a stationary player, asserts the cascaded-shadow configuration and receiver/caster policy, and keeps the existing quality and build suites as final gates.
