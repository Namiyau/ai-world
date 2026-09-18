# AI World — Babylon.js プロシージャルワールド・プロトタイプ

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

stylized low-poly 表現、seed に基づく無限プロシージャルワールド、クエストワールド、探索と経済のループを試す Babylon.js + TypeScript のブラウザ・プロトタイプです。

現在はプレイ可能なプロトタイプ段階です。メインワールド、クエストワールド、資源ループ、low-poly キャラクター、ビジュアルアセットを接続済みです。マルチプレイヤー、サーバー権威型セーブ、完全な本番パイプラインは今後の計画です。

## 機能ハイライト

| 分野 | 内容 |
| --- | --- |
| ワールド生成 | seed ベースの無限 chunk ストリーミング。丘陵、山地、草原、森林、岩地、安定した湖を生成 |
| シーンシステム | 道路、ランドマーク、湖畔の桟橋、橋、キャンプ、倉庫、採掘場、廃車地点を決定論的に配置 |
| 探索 | 一人称移動、ダッシュ、ジャンプ、段差越え、水中減速、クリエイティブ飛行 |
| キャラクター | 探索者、一般商人、荒野の近接敵。衣装、帽子、背負い物、道具をモジュール化 |
| 資源と経済 | 木材、石材、スクラップ、遺物、現金、資源価格、ショップ販売ループ |
| クエストワールド | より危険な世界へ移動し、追跡する敵と戦い、ドロップを回収して脱出 |
| ビジュアル | プロシージャルな空、軽量フォグ、low-poly 水面、flat shading、頂点カラー、インスタンス散布 |
| セーブ | `localStorage` 自動セーブ。World Delta は無限マップ全体ではなく回収済み資源 ID のみを記録 |

## クイックスタート

### 必要環境

- Node.js 20.19 以上、または Node.js 22.12 以上
- WebGL に対応した最新ブラウザ

### インストールと起動

```bash
npm install
npm run dev
```

Vite が表示するローカル URL（通常は `http://localhost:5173`）を開いてください。

Windows では、プロジェクトルートの `start-ai-world.ps1` または `启动AI世界.ps1` も利用できます。

### ビルドとチェック

```bash
# 型チェック
npx tsc --noEmit

# ユニットテスト
npm test

# 本番ビルドとローカルプレビュー
npm run build
npm run preview
```

ブラウザ受け入れスクリプトは `tests/browser-*` にあります。`npm test` には含まれない任意のローカル検証ツールで、実行には Playwright とブラウザの追加設定が必要です。

## 操作方法

| 入力 | アクション |
| --- | --- |
| 画面をクリック | マウスをロック |
| W / A / S / D | 移動 |
| Shift | ダッシュ。飛行中は下降 |
| Space | ジャンプ。2 回連続でクリエイティブ飛行を切り替え |
| E | インタラクト、回収、ショップ、テレポート |
| 左クリック | 近接攻撃 |
| Tab | インベントリを開く |
| Esc | ゲームメニューを開く |

飛行中は Space で上昇、Shift で下降し、地形に遮られません。水に入ると移動が遅くなり、カメラが水中に入ると画面の色調が変化します。

## 技術アーキテクチャ

```text
Browser / Vite
      │
      ▼
Game composition root
      │
      ├─ PlayerController   カメラ、移動、衝突、ジャンプ、飛行、水中判定
      ├─ Hud                所持金、インベントリ、通知、ランドマーク、Esc メニュー
      ├─ Systems            インタラクト、インベントリ、経済、戦闘、セーブ
      └─ WorldManager
           ├─ TerrainSampler  地形・水・道路の共通サンプリング源
           ├─ WaterLayer      湖のメッシュと水面 shader
           ├─ Roads           プロシージャル道路 ribbon
           ├─ Landmarks       遠景ランドマークとナビゲーション
           ├─ PoiLayer        人工シーン、装飾、資源ノード
           ├─ Details         インスタンス化された自然物
           ├─ Atmosphere       空、フォグ、ライティング、遠景クリップ
           └─ AssetManager     GLB キャッシュ、インスタンス化、fallback
```

### ワールド生成

すべての下流システムは純粋関数 `TerrainSampler.sample(x, z)` を共有します。

```text
Terrain → Climate → Water → Road
```

この関数は最終高度、水面高度、水深、道路距離、バイオーム、地表タイプ、色付け用の環境値を返します。そのため隣接 chunk は自然につながり、アンロード後に再ロードしても同じ結果になります。

### キャラクターとアセット

キャラクターの外観は `hair / headwear / outfit / lowerBody / footwear / carry / prop` のスロットに分割されています。将来の三人称視点、着せ替え、マルチプレイヤー同期に対応できる構成です。

ワールド生成器はモデルのパスではなく論理アセット ID を使用します。`AssetRegistry.ts` がカテゴリ、variant、LOD メタデータ、決定論的選択を管理し、`AssetManager.ts` が GLB キャッシュ、インスタンス化、アセット交換、プロシージャル fallback を担当します。

内蔵 Kenney CC0 GLB アセットの出典とライセンスは [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md) に記載しています。

## プロジェクト構成

```text
src/
  main.ts                         アプリケーション入口
  styles.css                     HUD スタイル
  game/
    Game.ts                       composition root とレンダーループ
    config.ts                     ワールド設定
    types.ts                      共通型
    player/
      PlayerController.ts         移動、衝突、ジャンプ、飛行、水中判定
      CharacterCatalog.ts         キャラクター外観とスロットカタログ
      CharacterVisuals.ts         low-poly キャラクター構築
    assets/
      AssetRegistry.ts            論理アセットと variant 選択
      AssetManager.ts              GLB キャッシュ、インスタンス化、fallback
      ResourceVisuals.ts           資源の見た目の組み合わせ
    systems/
      CombatSystem.ts             近接判定
      EconomySystem.ts            経済と売却
      InteractionSystem.ts        距離ターゲットと E アクション
      InventorySystem.ts          インベントリ
      SaveSystem.ts               セーブ
    ui/
      Hud.ts                      HUD と Esc メニュー
    world/
      TerrainSampler.ts           ワールド生成の共通ソース
      WaterLayer.ts               水面メッシュと shader
      Roads.ts                    道路 ribbon
      Landmarks.ts                ランドマークとコンパス
      PoiLayer.ts                 POI、装飾インスタンス、資源ノード
      CharacterShowcaseLayer.ts   キャラクター展示ポイント
      Details.ts                  インスタンス散布
      Atmosphere.ts               空、フォグ、ライティング
      WorldManager.ts             chunk ストリーミング
tests/
  *.test.ts                       ユニットテスト
  browser-*                       任意のブラウザ受け入れスクリプト
public/assets/                    Kenney CC0 GLB とライセンス記録
```

## 実装済み

- 一人称移動、ダッシュ、ジャンプ、段差越え、地形衝突、クリエイティブ飛行
- seed ベースの無限プロシージャルワールドと chunk ストリーミング
- 安定した湖、プロシージャル道路、遠景ランドマーク、HUD ナビゲーション
- 道路 POI、湖畔の桟橋、橋、採掘小屋、廃車地点、露出した鉱物
- 探索者、商人、荒野の近接敵を共通化した low-poly キャラクターカタログ
- プロシージャル資源、E キーによる近距離回収、現金、価格、メインワールドのショップ
- メインワールド → クエストワールド → 脱出の基本ループ
- クエストワールドの敵追跡、水域回避、地面追従、近接ドロップ
- `localStorage` 自動セーブと World Delta 増分記録
- 型チェック、ユニットテスト、本番ビルドを行う GitHub Actions

## ロードマップ

1. 独立 seed、危険度、報酬倍率、バイオーム設定を持つクエスト生成器
2. プレイヤーの体力、被弾フィードバック、Hit Stop、ノックバック
3. 道路と小屋、キャンプ、洞窟、倉庫の接続
4. 宝箱 Loot Table、レアリティ、ショップ購入
5. 銀行口座、利息、家、資産データモデル
6. 昼夜サイクルと環境状態の拡張
7. 長期探索向けの資源 ID 保存形式の圧縮
8. マルチプレイヤープロトコルとサーバー権威型経済境界の設計

## ライセンスと第三者アセット

このリポジトリでは、現在プロジェクト全体のオープンソースライセンスを宣言していません。第三者リソースは各原著ライセンスに従います。Kenney アセットは CC0 です。詳細は [`public/assets/ASSET_LICENSES.md`](public/assets/ASSET_LICENSES.md) と各アセットディレクトリの `License.txt` を参照してください。

これは拡張可能なブラウザ・プロトタイプであり、最終的な本番アーキテクチャではありません。プロシージャルジオメトリをテスト可能な fallback として維持し、モジュール式キャラクタースロットと humanoid skeleton 契約によって、将来の rigged GLB アセットに対応できるようにしています。
