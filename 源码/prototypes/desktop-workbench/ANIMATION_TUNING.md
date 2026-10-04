# 动效调优指南

**版本**: v0.6.1  
**调优目标**: 克制优雅、流畅自然、性能优先

---

## 1. 动效原则

### 克制优雅（Restrained Elegance）
- **少即是多**: 只在必要时使用动效，避免过度装饰
- **微妙过渡**: 位移 1-3px，缩放 1.01-1.03，避免夸张变化
- **优雅时长**: 快速响应（180ms）、自然过渡（250ms）、从容入场（350ms）
- **柔和缓动**: 优先 ease-out（入场）和 ease-in-out（双向），避免 linear

### 性能优先
- **GPU 加速**: 只使用 transform 和 opacity
- **避免触发重排**: 不动画 width/height/top/left/margin/padding
- **减少重绘**: 避免 box-shadow 过渡（使用 opacity 代替）
- **合成层隔离**: 使用 will-change（谨慎）或 transform: translateZ(0)

---

## 2. 当前动效清单

### 2.1 卡片悬停（Card Hover）
```css
/* 灵感/素材/藏书/项目卡片 */
transition: all var(--duration-fast) var(--ease-in-out);
```
**悬停效果**:
- `transform: translateY(-1px)` (项目卡片)
- `transform: translateY(-2px)` (素材卡片)
- `transform: translateY(-3px)` (藏书卡片)
- `box-shadow: var(--shadow-md)` 增强

**调优建议**:
- ✅ 已统一时长（180ms）
- ⚠️ 考虑将 box-shadow 改为 filter: drop-shadow()（性能更好）
- ⚠️ 统一 translateY 距离为 -2px（当前 -1 到 -3 不一致）

### 2.2 按钮悬停（Button Hover）
```css
.btn, .icon-btn, .text-btn
transition: all var(--duration-fast) var(--ease-in-out);
```
**悬停效果**:
- `.btn`: `translateY(-1px)` + 背景色变化
- `.icon-btn`: 背景色变化
- `.text-btn`: 颜色变化

**调优建议**:
- ✅ 时长统一
- ✅ 微妙位移合理
- ⚠️ 考虑 `.icon-btn` 也加入 `translateY(-0.5px)`（更统一）

### 2.3 视图切换（View Transition）
```css
.view-panel
animation: view-enter var(--duration-slow) var(--ease-out);
```
**效果**: `opacity: 0.7 → 1`

**调优建议**:
- ✅ 克制的透明度过渡
- ⚠️ 考虑加入 `transform: translateY(8px) → 0`（更有层次）
- ⚠️ 当前只有透明度变化，可能不够明显

### 2.4 列表阶梯入场（Stagger In）
```css
@keyframes stagger-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```
**应用**: 素材网格、藏书网格  
**延迟**: 0ms / 40ms / 80ms / 120ms / 160ms (cap)

**调优建议**:
- ✅ 延迟步进合理
- ✅ 位移距离适中
- ⚠️ 考虑将 cap 从第 5 项改为第 6 项（160ms 可能太早）
- ⚠️ 灵感视图和项目视图未应用 stagger

### 2.5 模态框入场（Modal Enter）
```css
@keyframes modal-enter {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```
**时长**: 250ms (--duration-base)

**调优建议**:
- ✅ 时长和缓动合理
- ✅ 位移距离适中
- ⚠️ backdrop fade-in 可以比内容早 50ms（更自然）

### 2.6 Toast 通知（Toast Enter）
```css
@keyframes toast-enter {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
```

**调优建议**:
- ✅ 轻盈的入场
- ⚠️ 考虑加入退场动画（当前直接消失）

### 2.7 空状态入场（Empty State）
```css
.empty-state, .project-empty, .schedule-list-empty, .schedule-timeline-empty
animation: fade-in var(--duration-base) var(--ease-out);
```

**调优建议**:
- ✅ 简单的 fade-in 合适
- ⚠️ 考虑加入 `transform: translateY(8px)`（更有层次）

### 2.8 同步状态脉动（Sync Pulse）
```css
@keyframes sync-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```
**时长**: 1.2s, infinite

**调优建议**:
- ✅ 脉动节奏合理
- ✅ 透明度范围适中
- ⚠️ 考虑使用 `cubic-bezier(0.4, 0, 0.6, 1)` 替代默认缓动

---

## 3. 性能调优检查清单

### 3.1 避免的属性（会触发重排）
- [ ] ❌ `width` / `height`
- [ ] ❌ `top` / `left` / `right` / `bottom`
- [ ] ❌ `margin` / `padding`
- [ ] ❌ `border-width`
- [ ] ❌ `font-size`

### 3.2 推荐的属性（GPU 加速）
- [x] ✅ `transform` (translate / scale / rotate)
- [x] ✅ `opacity`
- [ ] ⚠️ `filter` (谨慎使用，有性能成本)

### 3.3 优化技巧
- [ ] 使用 `will-change` 预告变化（仅关键动画）
- [ ] 避免同时动画多个元素（超过 20 个）
- [ ] 使用 `transform: translateZ(0)` 强制合成层
- [ ] 避免在滚动时触发动画
- [ ] 使用 `animation-fill-mode: backwards` 避免闪烁

---

## 4. 真机测试步骤

### 4.1 帧率测试
1. 打开 Chrome DevTools (Electron)
2. Performance → Record
3. 执行动画交互（悬停、切换视图、列表滚动）
4. 停止录制，检查 FPS 曲线

**目标**: 全程保持 60fps，无掉帧

### 4.2 动画流畅度主观评估
- [ ] 卡片悬停是否流畅自然？
- [ ] 视图切换是否平滑？
- [ ] 列表阶梯是否节奏合适？
- [ ] 模态框是否优雅入场？
- [ ] 整体感觉是否"克制优雅"？

### 4.3 减弱动效测试
1. 系统设置 → 辅助功能 → 显示 → 减弱动态效果
2. 或应用内设置 → 减少动态效果
3. 验证所有动画时长设为 0ms
4. 验证功能不受影响

---

## 5. 调优优先级

### P0 (必须修复)
1. 统一卡片悬停 translateY 距离（当前 -1 到 -3px 不一致）
2. 补全 Toast 退场动画（当前直接消失体验差）
3. 修复视图切换动画不明显问题（只有透明度）

### P1 (建议优化)
1. 灵感视图和项目视图加入 stagger-in 动画
2. box-shadow 改为 filter: drop-shadow()（性能优化）
3. modal backdrop 提前 50ms 入场
4. 空状态加入 translateY 过渡

### P2 (可选增强)
1. `.icon-btn` 加入微妙 translateY
2. stagger-in cap 延迟到第 6 项
3. sync-pulse 使用自定义缓动函数

---

## 6. 代码修改建议

### 6.1 统一卡片悬停距离
```css
/* 所有卡片统一为 -2px */
.materials-card:hover,
.books-card:hover,
.project-card:hover,
.inspiration-card:hover {
  transform: translateY(-2px);
}
```

### 6.2 Toast 退场动画
```css
.toast {
  animation: toast-enter var(--duration-base) var(--ease-out);
}

.toast.exiting {
  animation: toast-exit var(--duration-fast) var(--ease-in) forwards;
}

@keyframes toast-exit {
  from {
    opacity: 1;
    transform: translate(-50%, 0);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -8px);
  }
}
```

### 6.3 增强视图切换动画
```css
@keyframes view-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 6.4 box-shadow 性能优化
```css
/* 替换 */
.materials-card:hover {
  box-shadow: var(--shadow-md);
}

/* 为 */
.materials-card {
  filter: drop-shadow(0 2px 4px rgba(23, 40, 30, 0.08));
  transition: filter var(--duration-fast) var(--ease-in-out);
}

.materials-card:hover {
  filter: drop-shadow(0 4px 12px rgba(23, 40, 30, 0.12));
}
```

---

## 7. 监控指标

### 帧率目标
- **理想**: 60fps (16.67ms/frame)
- **可接受**: 55fps (18.18ms/frame)
- **需优化**: < 50fps

### 动画时长分布
- **快速交互**: 120-180ms (70%的动画)
- **基础过渡**: 200-250ms (25%的动画)
- **从容入场**: 300-350ms (5%的动画)

### 内存影响
- **单次动画**: < 1MB 额外内存
- **并发动画**: < 10MB 峰值增量

---

**创建时间**: 2026-09-29  
**版本**: v0.6.1  
**下次审查**: v0.7.0
