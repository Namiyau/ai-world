# Visual Foundation V1 implementation plan

1. Add regression tests for collision-resolved movement and ellipsoid-foot avatar anchoring; run them to establish the current failure.
2. Make collision resolution return the actual camera displacement and remove stationary downward collision pressure; add browser stillness coverage.
3. Add camera-relative cascaded shadows to `Atmosphere`, with explicit receiver/caster registration and near-player culling.
4. Register terrain, roads, major POI, landmarks, and substantial natural objects under the shadow policy; keep micro vegetation excluded.
5. Rebalance sunlight, fill light, fog, and the shader sky's lightweight cloud layer.
6. Run unit, build, and browser acceptance suites; inspect a live scene if an assertion or rendering diagnostic reveals an issue.
