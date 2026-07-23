# `_unwired/` — 写好了但没接线的模块

**这里的代码谁都调不到。** `dispatcher.mjs`（找岗总调度）的来源表 `ADAPTERS` 里没有它们，任何技能、脚本、测试也都不 import 它们——实测零引用。放在这里不是等着被删，是**备料**：代码本身是好的，只是还没接进流程。

规矩只有一条：**`shared/sourcing/` 平层里的模块 = 调度真能走到的；本目录里的 = 走不到的。** 不允许出现"看着像在用、其实走不到"的第三种状态。

## 里面有什么

| 文件 | 是什么 | 状态 |
|---|---|---|
| `smartrecruiters_board_api.mjs` | SmartRecruiters 岗位板抓取 | 2026-05-23 写的备料，从没接进调度 |
| `rippling_board_api.mjs` | Rippling 岗位板抓取 | 同上 |
| `personio_board_api.mjs` | Personio 岗位板抓取（含 XML 解析） | 同上 |
| `bamboohr_board_api.mjs` | BambooHR 岗位板抓取 | 同上 |
| `recruitee_board_api.mjs` | Recruitee 岗位板抓取 | 同上 |
| `computer_use_locator.mjs` | v0.5 视觉兜底定位器：CDP 选择器失效时改用视觉找页面元素 | 从没接进任何投递驱动 |

5 个抓取模块的接口是对齐的：都导出 `fetchJobs(tenant, opts)` / `fetchJobsForCompany(...)` / `filterByRoleType(...)`，也都带独立命令行入口，可以直接手工试跑：

```bash
node shared/sourcing/_unwired/personio_board_api.mjs <tenant>
```

⚠️ 它们的注释头互相写着「Interface mirrors xxx_board_api.mjs」。**那只是注释，不是调用**——盘点时别把它当成"有人在用"（这里踩过坑）。

## 想把某个抓取模块接上线，改两处

1. **`../dispatcher.mjs` 的 `ADAPTERS` 来源表**：照 `ashby_bulk` 那条的样子加一项，把该平台的 `fetchJobs` 包成统一的 `fetch({ keywords, limit, ... }) → jobs[]` 形状。`ALL_SOURCES` 是从 `ADAPTERS` 的键自动算出来的，不用手改。
2. **默认来源清单**：`dispatcher.mjs` 里默认跑哪几个来源的那份清单，按需决定新来源进不进默认档（不进就只能显式 `sources: [...]` 点名调用）。

另外，按平台走批量抓取还需要一份**租户名单**（对照 `../data/ashby_tenants.json`、`../data/lever_tenants.json` 的做法）——没名单的话抓取模块不知道该抓谁，这通常才是接线的真正工作量。

**接一个平台 = 产品决策，不是清理动作**：要配名单、跑真实抓取验证、承担长期维护。现行 PRD（`docs/PRD-improvements.md`）已用数据判定平台覆盖面不是瓶颈，所以本目录暂时按"待办清单"存着，别让它变成坟场。
