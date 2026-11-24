const state = { overview: {}, metrics: {}, dashboard: { totals: {}, daily: [] }, dashboardRange: { from: '', to: '', label: '今日' }, callbackConfig: {}, readiness: {}, bot: {}, channels: [], qrCodes: [], qrChannelSettings: [], qrMonitoring: { data: [], summary: {} }, qrOrders: [], qrSettlement: { data: [], summary: {} }, channelHealth: [], channelPreflights: {}, channelDetail: null, wechatMerchantStats: null, consistency: null, publicPaymentMonitoring: { summary: {}, events: [], recent: [] }, subjects: [], apps: [], merchants: [], clientMerchants: [], clientApiKeys: {}, clientMerchantAgents: [], clientMerchantGroups: [], platformMerchants: [], platformMerchantDetail: null, platformMerchantWechatBindings: [], platformMerchantLedger: [], platformMerchantLedgerMeta: {}, platformMerchantLedgerMetrics: {}, platformMerchantPrepaid: [], platformMerchantPrepaidMeta: {}, platformMerchantPrepaidSummary: {}, orders: [], ordersMeta: {}, ordersMetrics: {}, exceptions: [], exceptionsMeta: {}, exceptionMetrics: {}, memberBlocks: [], orderDetail: null, orderPage: 1, exceptionPage: 1, refunds: [], callbacks: [], callbackTasks: [], rules: [], monitoring: [], audits: [], adminUsers: [], adminRoles: [], settlementStatements: [], reconciliation: { runs: [], detail: null, settlement: [] } };
let platformMerchantChannelTarget = null;
let channelMerchantAuthTarget = null;
let merchantChannelBindingTarget = null;
let merchantChannelBindingTargets = [];
let merchantChannelBindingCreationTarget = null;
let merchantBatchRiskTargets = [];
let merchantBatchRiskSingle = false;
let merchantPaymentTestTarget = null;
let merchantPaymentTestOrderNo = '';
const modalPasswordCache = {};
const integrationVisibility = {};
let activePlatformTab = 'list';
const titles = {
  dashboard: ['首页仪表盘', '平台订单、通道和回调运行概览'], subjects: ['主体管理', '维护服务号和商户号背后的真实主体'],
  apps: ['AppID 管理', '维护服务号与商户号的授权绑定'], merchants: ['商户号管理', '查看商户号收款表现并管理通道配置'],
  'qr-codes': ['收款码管理', '批量维护挂码并分配到现有支付通道'], 'qr-routing': ['分配策略', '复用支付通道配置挂码权重和限额'], 'qr-monitoring': ['收款监控', '查看收款码状态、绑定和异常提醒'], 'qr-risk': ['挂码风控', '配置收款码时间窗口和每日进单规则'],
  channels: ['支付通道', '管理 Native 支付路由通道'], routing: ['路由策略', '配置金额分流、候选通道和优先级'],
  orders: ['支付订单', '查询订单状态并执行安全补偿'], exceptions: ['异常订单', '优先查单，再决定关单或人工处理'], 'member-blocks': ['会员封禁', '管理高风险会员的支付限制'], complaints: ['投诉订单', '跟进客户投诉、举证材料和处理进度'],
  refunds: ['退款管理', '退款沿用原订单支付通道'], callbacks: ['回调中心', '验签、解密、幂等和回调记录'], bot: ['BOT 通知中心', '配置中文命令、异常通知和接收群组'],
  reconciliation: ['对账结算', '汇总微信账单、退款和通道流水'], monitoring: ['监控告警', '观察通道、订单和回调健康度'], 'public-payment-monitoring': ['公众号支付监控', '观察临时文章、OAuth、JSAPI 和自动降级'], 'client-merchants': ['商户管理', '管理接入商户、账户余额、结算和分润'], 'platform-merchants': ['码商管理', '管理入驻、支付开关、通道授权和授信额度'], 'admin-users': ['管理员与角色', '配置后台账号和岗位权限'], audit: ['安全审计', '追踪凭证、路由和人工操作']
};
const ledgerTypeLabels = { INITIAL_BACKFILL: '历史余额初始化', ORDER_SUCCESS: '订单收款', REFUND_SUCCESS: '退款扣款', SETTLEMENT_RESERVE: '结算预占', SETTLEMENT_PAID: '结算打款', SETTLEMENT_VOID: '结算释放', ADMIN_ADJUST: '后台调额' };
function ledgerType(value) { return ledgerTypeLabels[value] || value; }

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (response.status === 401) showLoginGate();
  if (!response.ok) throw new Error(body.message || body.error || `请求失败: ${response.status}`);
  return body;
}

async function loadSession() {
  const response = await fetch('/api/v1/auth/me');
  if (response.status === 401) { showLoginGate(); return false; }
  const body = await response.json();
  if (body.data?.authEnabled) { document.querySelector('#loginGate').classList.add('hidden'); document.querySelector('#logoutButton').classList.remove('hidden'); }
  return true;
}

function showLoginGate() {
  document.querySelector('#loginGate').classList.remove('hidden');
}

function ensurePlatformMerchantDetailPanel() {
  if (document.querySelector('#platformMerchantDetail')) return;
  const card = document.querySelector('#view-platform-merchants .page-card');
  if (!card) return;
  card.insertAdjacentHTML('beforeend', `<div id="platformMerchantDetail" class="merchant-detail hidden"><div class="section-title"><div><div class="eyebrow">MERCHANT DETAIL</div><h3 id="merchantDetailTitle">码商详情</h3><p id="merchantDetailMeta" class="hint"></p></div><button class="ghost-button" data-close-platform-detail>关闭详情</button></div><p id="merchantDetailMessage" class="message"></p><h3 class="subsection-title">已授权通道</h3><p class="hint">通道授权在这里查看；通道绑定和轮询策略请在“商户管理 → 绑定通道”中设置。</p><div class="table-wrap"><table><thead><tr><th>通道</th><th>主体</th><th>AppID</th><th>商户号</th><th>状态</th><th>权重</th></tr></thead><tbody id="merchantDetailChannelRows"></tbody></table></div></div>`);
  if (!document.querySelector('#merchantDetailBackdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'merchantDetailBackdrop';
    backdrop.className = 'merchant-detail-backdrop hidden';
    backdrop.dataset.closePlatformDetail = '1';
    card.insertBefore(backdrop, document.querySelector('#platformMerchantDetail'));
  }
}

function enhancePlatformMerchantDetailPanel() {
  const panel = document.querySelector('#platformMerchantDetail');
  if (!panel) return;
  const title = panel.querySelector('.section-title');
  if (title && !title.querySelector('[data-toggle-platform-detail]')) {
    const toggle = document.createElement('button');
    toggle.className = 'ghost-button';
    toggle.dataset.togglePlatformDetail = '1';
    toggle.dataset.state = 'expanded';
    toggle.textContent = '全部收起';
    title.insertBefore(toggle, title.querySelector('[data-close-platform-detail]'));
  }
  if (!panel.dataset.detailSectionsEnhanced) {
    const grid = panel.querySelector('.merchant-detail-grid');
    if (grid) Array.from(grid.children).forEach((section) => {
      const heading = section.querySelector('h3');
      if (!heading) return;
      const details = document.createElement('details');
      details.className = 'detail-section';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = heading.textContent.trim();
      details.append(summary);
      heading.remove();
      while (section.firstChild) details.append(section.firstChild);
      section.replaceWith(details);
    });
    const statusSection = Array.from(panel.querySelectorAll('details.detail-section')).find((item) => item.querySelector('summary')?.textContent.trim() === '状态与运营');
    statusSection?.classList.add('hidden');
    const accountSection = Array.from(panel.querySelectorAll('details.detail-section')).find((item) => item.querySelector('summary')?.textContent.trim() === '后台账号');
    accountSection?.classList.add('hidden');
    ['后台账号', '已授权通道'].forEach((label) => {
      const heading = Array.from(panel.querySelectorAll('h3.subsection-title')).find((item) => item.textContent.trim() === label);
      if (!heading || heading.closest('details')) return;
      const details = document.createElement('details');
      details.className = 'detail-section';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = label;
      details.append(summary);
      heading.parentNode.insertBefore(details, heading);
      let cursor = heading.nextElementSibling;
      heading.remove();
      while (cursor && !(cursor.matches('h3.subsection-title'))) {
        const next = cursor.nextElementSibling;
        details.append(cursor);
        cursor = next;
      }
    });
    panel.dataset.detailSectionsEnhanced = '1';
    const accountSectionAfterWrap = Array.from(panel.querySelectorAll('details.detail-section')).find((item) => item.querySelector('summary')?.textContent.trim() === '后台账号');
    accountSectionAfterWrap?.classList.add('hidden');
  }
  ['最近订单', '最近退款'].forEach((label) => {
    const heading = Array.from(panel.querySelectorAll('h3.subsection-title')).find((item) => item.textContent.trim() === label);
    if (heading) {
      heading.classList.add('hidden');
      heading.nextElementSibling?.classList.add('hidden');
    }
  });
  panel.querySelector('#merchantFinancialBlock')?.classList.add('hidden');
  const creditBlock = panel.querySelector('#merchantCreditBlock');
  if (creditBlock && !creditBlock.dataset.collapsible) {
    const details = document.createElement('details');
    details.id = creditBlock.id;
    details.className = 'detail-section';
    details.open = false;
    const summary = document.createElement('summary');
    summary.textContent = '收款授信额度';
    details.append(summary);
    while (creditBlock.firstChild) details.append(creditBlock.firstChild);
    details.querySelector('.subsection-head')?.remove();
    details.dataset.collapsible = '1';
    creditBlock.replaceWith(details);
  }
}

function renderPlatformMerchantDetail() {
  const detail = state.platformMerchantDetail;
  const panel = document.querySelector('#platformMerchantDetail');
  if (!panel) return;
  const backdrop = document.querySelector('#merchantDetailBackdrop');
  if (!detail) { panel.classList.add('hidden'); backdrop?.classList.add('hidden'); return; }
  panel.classList.remove('hidden'); backdrop?.classList.remove('hidden');
  setText('merchantDetailTitle', detail.name);
  setText('merchantDetailMeta', `${detail.code} · 创建于 ${date(detail.createdAt)} · 最近活跃 ${date(detail.lastActiveAt)}`);
  const financial = detail.financial || {}; const policy = financial.policy || {}; const usage = financial.usage || {};
  document.querySelector('#merchantDetailChannelRows').innerHTML = detail.channels?.length ? detail.channels.map((item) => `<tr><td class="mono">${esc(item.id)}</td><td>${esc(item.subjectName)}</td><td class="mono">${esc(item.appId)}</td><td class="mono">${esc(item.mchId)}</td><td>${statusTag(item.status)}</td><td>${item.routeWeight}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">尚未授权通道</td></tr>';
  if (!document.querySelector('#merchantWechatBindingBlock')) panel.insertAdjacentHTML('beforeend', '<div id="merchantWechatBindingBlock"><h3 class="subsection-title">名下微信商户号</h3><p class="hint">一个码商可以绑定多个微信商户号，通道策略会在这些商户号之间分配订单。</p><div class="table-wrap"><table><thead><tr><th>商户号</th><th>状态</th><th>轮询权重</th><th>并发上限</th><th>单笔金额区间（分）</th><th>日限额（分）</th><th>日订单</th></tr></thead><tbody id="merchantWechatBindingRows"></tbody></table></div><div class="form-actions"><button class="ghost-button" data-add-wechat-binding>添加商户号</button><button class="primary-button" data-save-wechat-bindings>保存商户号绑定</button></div></div>');
  document.querySelector('#merchantWechatBindingRows').innerHTML = state.platformMerchantWechatBindings.length ? state.platformMerchantWechatBindings.map((item) => `<tr><td class="mono">${esc(item.mchid)}</td><td>${statusTag(item.status === 'ACTIVE' && item.merchantStatus === 'ACTIVE' ? 'ACTIVE' : 'DISABLED')}</td><td><input class="binding-inline-input" type="number" min="1" value="${Number(item.routeWeight || 100)}" data-wechat-binding-weight="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.maxConcurrency || 0) || ''}" data-wechat-binding-concurrency="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="1" value="${Number(item.minOrderAmount || 1)}" data-wechat-binding-min="${esc(item.id)}"><input class="binding-inline-input" type="number" min="0" value="${Number(item.maxOrderAmount || 0) || ''}" data-wechat-binding-max="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.dailyAmountLimit || 0) || ''}" data-wechat-binding-daily="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.dailyOrderLimit || 0) || ''}" data-wechat-binding-orders="${esc(item.id)}"></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂未绑定微信商户号，请先在商户号管理中绑定</td></tr>';
  if (!document.querySelector('#merchantFinancialBlock')) panel.insertAdjacentHTML('beforeend', '<div id="merchantFinancialBlock"><h3 class="subsection-title">资金与额度</h3><p id="merchantFinancialPolicy" class="hint"></p><div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>金额</th><th>可用余额</th><th>待结算</th><th>说明</th></tr></thead><tbody id="merchantLedgerRows"></tbody></table></div><h4>额度预警</h4><div id="merchantAlertRows" class="hint"></div></div>');
  if (!document.querySelector('#merchantCreditBlock')) panel.insertAdjacentHTML('beforeend', '<div id="merchantCreditBlock"><div class="subsection-head"><h4>收款授信额度</h4></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>变动</th><th>额度余额</th><th>说明</th></tr></thead><tbody id="merchantCreditRows"></tbody></table></div></div>');
  document.querySelector('#merchantFinancialPolicy').textContent = `单笔 ¥${money(policy.minOrderAmount)} - ¥${money(policy.maxOrderAmount)}；单日金额 ${policy.dailyAmountLimit ? `¥${money(policy.dailyAmountLimit)}` : '不限'}；待结算上限 ${policy.pendingAmountLimit ? `¥${money(policy.pendingAmountLimit)}` : '不限'}；预占订单 ${usage.reservedOrderCount || 0} 笔`;
  document.querySelector('#merchantLedgerRows').innerHTML = detail.ledger?.length ? detail.ledger.map((item) => `<tr><td>${date(item.createdAt)}</td><td>${esc(ledgerType(item.entryType))}</td><td>${Number(item.amount) >= 0 ? '+' : ''}¥${money(item.amount)}</td><td>¥${money(item.availableAfter)}</td><td>¥${money(item.pendingAfter)}</td><td>${esc(item.note || '-')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">暂无账务流水</td></tr>';
  document.querySelector('#merchantAlertRows').innerHTML = detail.alerts?.length ? detail.alerts.slice(0, 8).map((item) => `<span class="tag ${item.level === 'CRITICAL' ? 'danger' : 'warning'}">${item.level === 'CRITICAL' ? '严重' : '预警'} · ${esc(item.message)} · ${item.status === 'OPEN' ? '未处理' : '已恢复'}</span>`).join(' ') : '暂无额度预警';
  document.querySelector('#merchantCreditRows').innerHTML = detail.creditLedger?.length ? detail.creditLedger.map((item) => `<tr><td>${date(item.createdAt)}</td><td>${item.entryType === 'GRANT' ? '平台增加' : item.entryType === 'DEDUCT' ? '平台扣减' : item.entryType}</td><td>${Number(item.amount) >= 0 ? '+' : ''}¥${money(item.amount)}</td><td>¥${money(item.quotaAfter)}</td><td>${esc(item.note || '-')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无额度流水</td></tr>';
  enhancePlatformMerchantDetailPanel();
}

async function openPlatformMerchantDetail(id) {
  const [detail, bindings] = await Promise.all([api(`/api/v1/admin/platform-merchants/${encodeURIComponent(id)}`), api(`/api/v1/admin/platform-merchants/${encodeURIComponent(id)}/wechat-merchants`)]);
  state.platformMerchantDetail = detail.data; state.platformMerchantWechatBindings = bindings.data || [];
  renderPlatformMerchantDetail();
}

function filteredPlatformMerchants() {
  const search = (document.querySelector('#platformMerchantSearch')?.value || '').trim().toLowerCase();
  const status = document.querySelector('#platformMerchantStatusFilter')?.value || '';
  const health = document.querySelector('#platformMerchantHealthFilter')?.value || '';
  const showDisabled = Boolean(document.querySelector('#platformMerchantShowDisabled')?.checked);
  return state.platformMerchants.filter((item) => {
    const matchesSearch = !search || [item.id, item.code, item.name, item.loginUsername].some((value) => String(value || '').toLowerCase().includes(search));
    const matchesStatus = !status || item.status === status;
    const matchesDisabled = showDisabled || !['DISABLED', 'ARCHIVED'].includes(String(item.status));
    const matchesHealth = !health || (health === 'CREDIT_WARNING' ? Number(item.openAlertCount || 0) > 0 : health === 'NO_CHANNEL' ? Number(item.activeChannelCount || 0) === 0 : Number(item.openAlertCount || 0) === 0 && Number(item.activeChannelCount || 0) > 0);
    return matchesSearch && matchesStatus && matchesDisabled && matchesHealth;
  });
}

async function openPlatformMerchantModal(item) {
  const form = document.querySelector('#platformMerchantForm');
  form.reset();
  const editing = Boolean(item);
  form.elements.editId.value = item?.id || '';
  form.elements.name.value = item?.name || '';
  form.elements.username.value = item?.loginUsername || '';
  form.elements.settlementRate.value = item?.settlementRate ?? 0;
  form.elements.maxOrderAmount.value = item?.maxOrderAmount ?? 10000000;
  form.elements.dailyAmountLimit.value = item?.dailyAmountLimit ?? 0;
  form.elements.dailyOrderLimit.value = item?.dailyOrderLimit ?? 0;
  form.elements.minOrderAmount.value = 1;
  form.elements.pendingAmountLimit.value = 0;
  form.elements.pendingOrderLimit.value = 0;
  form.elements.warningRatio.value = 0.8;
  form.elements.criticalRatio.value = 0.95;
  const creditAdjust = document.querySelector('#platformMerchantCreditAdjust');
  creditAdjust?.classList.toggle('hidden', !editing);
  document.querySelector('#platformMerchantCreditAmount').value = '';
  document.querySelector('#platformMerchantCreditWarningAmount').value = editing ? Number(item?.creditWarningAmount || 0) : 0;
  document.querySelector('#platformMerchantCreditMessage').textContent = '';
  document.querySelector('#platformMerchantCreditSummary').textContent = editing ? `当前余额 ¥${money(item?.quotaBalance || 0)}，已用 ¥${money(item?.quotaUsed || 0)}，预警额度 ¥${money(item?.creditWarningAmount || 0)}，单位：分` : '编辑码商后可调整授信额度';
  form.elements.username.readOnly = editing;
  form.elements.username.required = !editing;
  form.elements.username.placeholder = editing && !item?.loginUsername ? '请在详情面板创建账号' : 'zhangsan';
  form.elements.initialPassword.required = !editing;
  document.querySelector('#platformMerchantPasswordLabel').classList.toggle('hidden', editing);
  document.querySelector('#platformMerchantModalTitle').textContent = editing ? '编辑码商' : '新增码商';
  document.querySelector('#platformMerchantFormMessage').textContent = '';
  document.querySelector('#platformMerchantFormMessage').className = 'message';
  document.querySelector('#platformMerchantModal').classList.remove('hidden');
  const riskSection = document.querySelector('#platformMerchantRiskPolicy');
  riskSection?.setAttribute('open', '');
  if (editing) {
    try {
      const account = (await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(item.id)}/account`)).data || {};
      const policy = account.policy || {};
      form.elements.minOrderAmount.value = policy.minOrderAmount ?? 1;
      form.elements.maxOrderAmount.value = policy.maxOrderAmount ?? item.maxOrderAmount ?? 10000000;
      form.elements.dailyAmountLimit.value = policy.dailyAmountLimit ?? item.dailyAmountLimit ?? 0;
      form.elements.dailyOrderLimit.value = policy.dailyOrderLimit ?? item.dailyOrderLimit ?? 0;
      form.elements.pendingAmountLimit.value = policy.pendingAmountLimit ?? 0;
      form.elements.pendingOrderLimit.value = policy.pendingOrderLimit ?? 0;
      form.elements.warningRatio.value = policy.warningRatio ?? 0.8;
      form.elements.criticalRatio.value = policy.criticalRatio ?? 0.95;
      document.querySelector('#platformMerchantCreditWarningAmount').value = Number(policy.creditWarningAmount ?? item.creditWarningAmount ?? 0);
      document.querySelector('#platformMerchantCreditSummary').textContent = `当前余额 ¥${money(account.quotaBalance || 0)}，已用 ¥${money(account.quotaUsed || 0)}，预警额度 ¥${money(policy.creditWarningAmount ?? item.creditWarningAmount ?? 0)}，单位：分`;
    } catch (error) {
      setMessage('platformMerchantFormMessage', `读取风控策略失败：${error.message || String(error)}`, true);
    }
  }
  setTimeout(() => form.elements.name.focus(), 0);
}

function closePlatformMerchantModal() { document.querySelector('#platformMerchantModal')?.classList.add('hidden'); }

function closePlatformMerchantChannelsModal() {
  platformMerchantChannelTarget = null;
  document.querySelector('#platformMerchantChannelsModal')?.classList.add('hidden');
}

async function openPlatformMerchantChannelsModal(merchantId) {
  const merchant = state.platformMerchants.find((item) => String(item.id) === String(merchantId));
  if (!merchant) return;
  platformMerchantChannelTarget = String(merchantId);
  const options = document.querySelector('#platformMerchantChannelOptions');
  setText('platformMerchantChannelsTitle', `配置通道 · ${merchant.name}`);
  setText('platformMerchantChannelsHint', '只授权码商实际可用的支付通道；未勾选的通道不会参与该码商的路由。');
  setMessage('platformMerchantChannelsMessage', '正在读取当前授权…', false);
  options.innerHTML = '<p class="hint">正在加载通道…</p>';
  document.querySelector('#platformMerchantChannelsModal')?.classList.remove('hidden');
  try {
    const current = (await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(merchantId)}/channels`)).data || [];
    const selected = new Set(current.map((item) => String(item.id)));
    options.innerHTML = state.channels.length ? state.channels.map((channel) => `<label class="channel-option"><input type="checkbox" value="${esc(channel.id)}" ${selected.has(String(channel.id)) ? 'checked' : ''}><span class="channel-option-body"><span class="channel-option-title">${esc(channel.id)} · ${channel.merchantCount ?? channel.merchantIds?.length ?? 0} 个商户</span><span class="channel-option-meta">主商户：${esc(channel.mchId || '-')} · ${esc(labelOf(channelReadiness(channel)))}</span></span></label>`).join('') : '<p class="hint">暂无可授权通道，请先在支付通道中完成配置。</p>';
    setMessage('platformMerchantChannelsMessage', `已授权 ${selected.size} 个通道`, false);
  } catch (error) {
    options.innerHTML = '<p class="hint">通道加载失败，请重试。</p>';
    showError(error, 'platformMerchantChannelsMessage');
  }
}

function buildOrderQuery(exception = false) {
  const prefix = exception ? 'exception' : 'order'; const params = new URLSearchParams(); const get = (name) => document.querySelector(`#${prefix}${name}`)?.value || '';
  const values = { q: get('Query'), status: get('StatusFilter'), channelId: get('ChannelFilter'), merchantId: get('MerchantFilter'), dateFrom: get('DateFrom'), dateTo: get('DateTo'), amountMin: get('AmountMin'), amountMax: get('AmountMax') };
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); }); params.set('page', String(exception ? state.exceptionPage : state.orderPage)); params.set('pageSize', '50'); return params.toString();
}

function ensurePlatformMerchantWorkspace() {
  const card = document.querySelector('#view-platform-merchants .page-card');
  if (!card || card.querySelector('#platformMerchantSubtabs')) return;
  const title = card.querySelector('.section-title');
  const tabs = document.createElement('div');
  tabs.id = 'platformMerchantSubtabs';
  tabs.className = 'platform-subtabs hidden';
  tabs.innerHTML = '<button type="button" class="platform-subtab active" data-platform-tab="list">码商列表</button><button type="button" class="platform-subtab" data-platform-tab="ledger">资金流水</button><button type="button" class="platform-subtab" data-platform-tab="prepaid">预付记录</button>';
  title?.after(tabs);
  const listTable = card.querySelector('#platformMerchantRows')?.closest('table');
  if (listTable) listTable.querySelector('thead').innerHTML = '<tr><th>码商信息</th><th>归属信息</th><th>代收预付</th><th>是否启用</th><th>代收</th><th>操作</th></tr>';
  const listFilters = card.querySelector('.merchant-filters');
  if (listFilters) listFilters.insertAdjacentHTML('beforeend', '<label class="platform-disabled-toggle"><input id="platformMerchantShowDisabled" type="checkbox"> 显示停用数据</label><button type="button" class="primary-button" id="platformMerchantSearchButton">搜索</button>');
  ['.merchant-toolbar', '.merchant-filters', '#platformMerchantMessage', '.merchant-toolbar + .merchant-filters + .message', '#platformMerchantRows']
    .map((selector) => card.querySelector(selector)?.closest('.table-wrap') || card.querySelector(selector))
    .filter(Boolean)
    .forEach((node) => node.dataset.platformListBlock = '1');
  const panel = document.createElement('div');
  panel.id = 'platformMerchantLedgerPanel';
  panel.className = 'platform-finance-panel hidden';
  panel.innerHTML = '<div class="platform-finance-toolbar"><div class="platform-finance-filters"><select id="platformLedgerMerchantFilter"><option value="">所属码商</option></select><select id="platformLedgerTypeFilter"><option value="">业务类型</option><option value="ORDER_SUCCESS">订单收款</option><option value="REFUND_SUCCESS">退款扣款</option><option value="SETTLEMENT_RESERVE">结算预占</option><option value="SETTLEMENT_PAID">结算打款</option><option value="SETTLEMENT_VOID">结算释放</option></select><input id="platformLedgerNoteFilter" placeholder="备注 / 订单号" /><input id="platformLedgerDateFrom" type="date" /><span class="date-separator">至</span><input id="platformLedgerDateTo" type="date" /><button type="button" class="ghost-button" id="platformLedgerReset">重置</button><button type="button" class="primary-button" id="platformLedgerSearch">查询</button></div><div class="platform-finance-actions"><button type="button" class="ghost-button" id="platformLedgerExport">导出 CSV</button></div></div><div class="finance-summary"><article><span>流水笔数</span><strong id="platformLedgerMetricCount">0</strong></article><article><span>收入合计</span><strong id="platformLedgerMetricIncome" class="money-positive">¥0.00</strong></article><article><span>支出合计</span><strong id="platformLedgerMetricExpense" class="money-negative">¥0.00</strong></article></div><p id="platformLedgerMessage" class="message"></p><div class="table-wrap"><table><thead><tr><th>码商ID</th><th>码商名称</th><th>变更前余额</th><th>变更金额</th><th>变更后余额</th><th>变更类型</th><th>通道名称</th><th>业务订单号</th><th>备注</th><th>创建时间</th></tr></thead><tbody id="platformLedgerRows"></tbody></table></div><div class="pagination" id="platformLedgerPagination"></div>';
  card.append(panel);
  const prepaid = document.createElement('div');
  prepaid.id = 'platformMerchantPrepaidPanel';
  prepaid.className = 'platform-finance-panel hidden';
  prepaid.innerHTML = '<div class="platform-finance-toolbar"><div class="platform-finance-filters"><select id="platformPrepaidMerchantFilter"><option value="">所属码商</option></select><select id="platformPrepaidTypeFilter"><option value="">变更类型</option><option value="GRANT">平台充值</option><option value="DEDUCT">平台扣减</option><option value="TRANSFER_IN">余额转入</option><option value="ORDER_CONSUME">订单消耗</option></select><input id="platformPrepaidDateFrom" type="date" /><span class="date-separator">至</span><input id="platformPrepaidDateTo" type="date" /><button type="button" class="ghost-button" id="platformPrepaidReset">重置</button><button type="button" class="primary-button" id="platformPrepaidSearch">查询</button></div><div class="platform-finance-actions"><button type="button" class="ghost-button" id="platformPrepaidExport">导出 CSV</button></div></div><div class="prepaid-summary"><span>总剩余预付：<strong id="platformPrepaidTotal">¥0.00</strong></span><span>今日打款：<strong id="platformPrepaidToday">¥0.00</strong></span><span>昨日打款：<strong id="platformPrepaidYesterday">¥0.00</strong></span></div><p id="platformPrepaidMessage" class="message"></p><div class="table-wrap"><table><thead><tr><th>码商ID</th><th>码商名称</th><th>变更前预付</th><th>变更金额</th><th>变更后预付</th><th>变更类型</th><th>汇率</th><th>转账凭证</th><th>操作人</th><th>创建时间</th></tr></thead><tbody id="platformPrepaidRows"></tbody></table></div><div class="pagination" id="platformPrepaidPagination"></div>';
  card.append(prepaid);
  card.querySelectorAll('[data-platform-list-block]').forEach((node) => node.dataset.platformListBlock = '1');
}

function setPlatformMerchantTab(tab) {
  const card = document.querySelector('#view-platform-merchants .page-card');
  if (!card) return;
  activePlatformTab = ['list', 'ledger', 'prepaid'].includes(tab) ? tab : 'list';
  tab = activePlatformTab;
  card.querySelectorAll('[data-platform-tab]').forEach((button) => button.classList.toggle('active', button.dataset.platformTab === tab));
  document.querySelectorAll('[data-platform-tab-target]').forEach((button) => button.classList.toggle('active', button.dataset.platformTabTarget === tab));
  card.querySelectorAll('[data-platform-list-block]').forEach((node) => node.classList.toggle('hidden', tab !== 'list'));
  card.querySelector('#platformMerchantLedgerPanel')?.classList.toggle('hidden', tab !== 'ledger');
  card.querySelector('#platformMerchantPrepaidPanel')?.classList.toggle('hidden', tab !== 'prepaid');
  if (tab !== 'list') void loadPlatformMerchantFinance();
}

function platformFinanceQuery(prefix, page = 1) {
  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  const merchant = document.querySelector(`#${prefix}MerchantFilter`)?.value;
  const type = document.querySelector(`#${prefix}TypeFilter`)?.value;
  const from = document.querySelector(`#${prefix}DateFrom`)?.value;
  const to = document.querySelector(`#${prefix}DateTo`)?.value;
  if (merchant) params.set('merchantId', merchant);
  if (type) params.set('entryType', type);
  if (from) params.set('dateFrom', new Date(`${from}T00:00:00+08:00`).toISOString());
  if (to) params.set('dateTo', new Date(`${to}T00:00:00+08:00`).toISOString());
  if (prefix === 'platformLedger') { const q = document.querySelector('#platformLedgerNoteFilter')?.value.trim(); if (q) params.set('q', q); }
  return params.toString();
}

function refreshPlatformFinanceMerchantFilters() {
  [['platformLedgerMerchantFilter', '所属码商'], ['platformPrepaidMerchantFilter', '所属码商']].forEach(([id, label]) => {
    const node = document.querySelector(`#${id}`); if (!node) return;
    const current = node.value;
    node.innerHTML = `<option value="">${label}</option>` + state.platformMerchants.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.code)}</option>`).join('');
    if (current) node.value = current;
  });
}

function renderPlatformMerchantFinance() {
  const ledgerRows = document.querySelector('#platformLedgerRows');
  if (ledgerRows) ledgerRows.innerHTML = state.platformMerchantLedger.length ? state.platformMerchantLedger.map((item) => `<tr><td class="mono">${esc(item.merchantCode || item.merchantId)}</td><td>${esc(item.merchantName)}</td><td>¥${money(item.balanceBefore)}</td><td class="${Number(item.amount) >= 0 ? 'money-positive' : 'money-negative'}">${Number(item.amount) >= 0 ? '+' : ''}¥${money(item.amount)}</td><td>¥${money(item.balanceAfter)}</td><td>${esc(ledgerType(item.entryType))}</td><td>${esc(item.channelName || '-')}</td><td class="mono">${esc(item.businessOrderNo || item.referenceId || '-')}</td><td>${esc(item.note || '-')}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="10" class="empty-cell">暂无资金流水</td></tr>';
  setText('platformLedgerMetricCount', state.platformMerchantLedgerMetrics.count || 0); setText('platformLedgerMetricIncome', `¥${money(state.platformMerchantLedgerMetrics.income || 0)}`); setText('platformLedgerMetricExpense', `¥${money(state.platformMerchantLedgerMetrics.expense || 0)}`);
  const prepaidRows = document.querySelector('#platformPrepaidRows');
  if (prepaidRows) prepaidRows.innerHTML = state.platformMerchantPrepaid.length ? state.platformMerchantPrepaid.map((item) => `<tr><td class="mono">${esc(item.merchantCode || item.merchantId)}</td><td>${esc(item.merchantName)}</td><td>¥${money(item.prepaidBefore)}</td><td class="${Number(item.amount) >= 0 ? 'money-positive' : 'money-negative'}">${Number(item.amount) >= 0 ? '+' : ''}¥${money(item.amount)}</td><td>¥${money(item.prepaidAfter)}</td><td>${esc(item.entryType === 'GRANT' ? '平台充值' : item.entryType === 'DEDUCT' ? '平台扣减' : item.entryType === 'TRANSFER_IN' ? '余额转入' : item.entryType === 'ORDER_CONSUME' ? '订单消耗' : item.entryType)}</td><td>${Number(item.exchangeRate || 1).toFixed(4)}</td><td>${esc(item.transferProof || '-')}</td><td>${esc(item.operator || '-')}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="10" class="empty-cell">暂无预付记录</td></tr>';
  setText('platformPrepaidTotal', `¥${money(state.platformMerchantPrepaidSummary.totalPrepaid || 0)}`); setText('platformPrepaidToday', `¥${money(state.platformMerchantPrepaidSummary.todayPaid || 0)}`); setText('platformPrepaidYesterday', `¥${money(state.platformMerchantPrepaidSummary.yesterdayPaid || 0)}`);
}

async function loadPlatformMerchantFinance() {
  refreshPlatformFinanceMerchantFilters();
  const ledgerUrl = `/api/v1/admin/platform-merchant-ledger?${platformFinanceQuery('platformLedger')}`;
  const prepaidUrl = `/api/v1/admin/platform-merchant-prepaid?${platformFinanceQuery('platformPrepaid')}`;
  try {
    const [ledger, prepaid] = await Promise.all([api(ledgerUrl), api(prepaidUrl)]);
    state.platformMerchantLedger = ledger.data || []; state.platformMerchantLedgerMeta = ledger.meta || {}; state.platformMerchantLedgerMetrics = ledger.metrics || {};
    state.platformMerchantPrepaid = prepaid.data || []; state.platformMerchantPrepaidMeta = prepaid.meta || {}; state.platformMerchantPrepaidSummary = prepaid.summary || {};
    renderPlatformMerchantFinance();
  } catch (error) { setMessage('platformLedgerMessage', error.message || String(error), true); setMessage('platformPrepaidMessage', error.message || String(error), true); }
}
async function openRouteRuleVersions(id) {
  const result = await api(`/api/v1/admin/routing-rules/${encodeURIComponent(id)}/versions`); const rows = result.data || [];
  let panel = document.querySelector('#routeRuleVersionsModal');
  if (!panel) { document.body.insertAdjacentHTML('beforeend', '<div id="routeRuleVersionsModal" class="modal-backdrop hidden"><div class="modal-card"><div class="section-title"><div><div class="eyebrow">ROUTE VERSIONS</div><h3>路由规则版本</h3></div><button class="ghost-button" data-close-route-versions>关闭</button></div><div id="routeRuleVersionsBody"></div></div></div>'); panel = document.querySelector('#routeRuleVersionsModal'); }
  document.querySelector('#routeRuleVersionsBody').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>版本</th><th>变更</th><th>操作人</th><th>时间</th><th>配置</th><th>操作</th></tr></thead><tbody>${rows.map((row) => `<tr><td>v${row.version}</td><td>${labelOf(row.changeType)}</td><td>${esc(row.operator)}</td><td>${date(row.createdAt)}</td><td class="mono">${esc(JSON.stringify(row.snapshot))}</td><td>${Number(row.version) === Number(rows[0].version) ? '<span class="subtle">当前版本</span>' : `<button class="table-button" data-route-rollback="${esc(id)}" data-route-version="${esc(row.version)}">回滚</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-cell">暂无版本记录</p>';
  panel.classList.remove('hidden');
}
function renderPagination(id, meta) { const node = document.querySelector(`#${id}`); if (!node || !meta?.total) { if (node) node.innerHTML = ''; return; } node.innerHTML = `<span>第 ${meta.page} / ${meta.totalPages} 页，共 ${meta.total} 条</span><button class="ghost-button" ${meta.page <= 1 ? 'disabled' : ''} data-page-prev="${id}">上一页</button><button class="ghost-button" ${meta.page >= meta.totalPages ? 'disabled' : ''} data-page-next="${id}">下一页</button>`; }
function memberBlockScopeLabel(item) { return item.scopeType === 'GLOBAL' ? '全局' : item.scopeType === 'CHANNEL' ? `通道 ${item.scopeId || '-'}` : `商户 ${item.scopeId || '-'}`; }
function memberBlockStatusLabel(status) { return { ACTIVE: '生效中', EXPIRED: '已过期', REVOKED: '已解除' }[status] || status || '-'; }
function memberBlockRow(item) {
  const keys = (item.keys || []).map((key) => `<span>${esc({ MEMBER_ID: '会员', OPENID_HASH: 'OpenID', IP: 'IP', DEVICE_ID: '设备' }[key.keyType] || key.keyType)}：<b class="mono">${esc(key.displayValue || '-')}</b></span>`).join('<br>');
  const action = item.status === 'ACTIVE' ? `<button class="table-button danger-item" data-revoke-member-block="${esc(item.id)}">解封</button>` : '-';
  return `<tr><td><div class="member-block-key-list">${keys || '<span>-</span>'}</div></td><td>${esc(memberBlockScopeLabel(item))}</td><td class="mono">${esc(item.sourcePlatformOrderNo || '-')}</td><td>${esc(item.reason)}</td><td>${statusTag(item.status)}<br><small>${esc(memberBlockStatusLabel(item.status))}</small></td><td>${date(item.createdAt)}<br><small>${item.expiresAt ? `到 ${date(item.expiresAt)}` : '永久'}</small></td><td>${action}</td></tr>`;
}
function renderMemberBlocks() {
  const rows = document.querySelector('#memberBlockRows'); if (!rows) return;
  const query = String(document.querySelector('#memberBlockQuery')?.value || '').trim().toLowerCase(); const status = document.querySelector('#memberBlockStatus')?.value || '';
  const filtered = state.memberBlocks.filter((item) => (!status || item.status === status) && (!query || JSON.stringify(item).toLowerCase().includes(query)));
  rows.innerHTML = filtered.length ? filtered.map(memberBlockRow).join('') : '<tr><td colspan="7" class="empty-cell">暂无会员封禁记录</td></tr>';
}
async function loadMemberBlocks() { const result = await api('/api/v1/admin/member-blocks?limit=500'); state.memberBlocks = result.data || []; renderMemberBlocks(); }
function openMemberBlockModal(id) {
  const order = state.orders.find((item) => String(item.id) === String(id)) || (state.orderDetail && String(state.orderDetail.id) === String(id) ? state.orderDetail : null); const modal = document.querySelector('#memberBlockModal'); const form = document.querySelector('#memberBlockForm');
  if (!order || !modal || !form) return;
  form.reset(); form.elements.orderId.value = order.id; document.querySelector('#memberBlockTitle').textContent = `拉黑会员 · ${order.platformOrderNo}`; document.querySelector('#memberBlockMeta').textContent = `${order.merchantName || order.merchantId} · ¥${money(order.amount)} · ${order.deviceIp || '未知 IP'}`;
  const values = { MEMBER_ID: order.userId || '', OPENID_HASH: order.paymentOpenidHash || '', IP: order.deviceIp || '', DEVICE_ID: order.deviceNo || '' };
  document.querySelectorAll('[data-block-candidate]').forEach((node) => { const key = node.dataset.blockCandidate; const rawValue = values[key] || ''; const value = rawValue && key === 'OPENID_HASH' ? `${rawValue.slice(0, 8)}***${rawValue.slice(-6)}` : rawValue || '不可用'; node.textContent = value; const checkbox = form.querySelector(`input[name="keyTypes"][value="${key}"]`); if (checkbox) { checkbox.disabled = !rawValue; checkbox.checked = Boolean(rawValue) && key === 'MEMBER_ID'; } });
  document.querySelector('#memberBlockFormMessage').textContent = ''; modal.classList.remove('hidden'); setTimeout(() => form.elements.reason?.focus(), 0);
}
function closeMemberBlockModal() { document.querySelector('#memberBlockModal')?.classList.add('hidden'); }
function renderOrderDetail() {
  const detail = state.orderDetail; const body = document.querySelector('#orderDetailBody'); if (!body) return; if (!detail) { document.querySelector('#orderDetailModal').classList.add('hidden'); return; }
  document.querySelector('#orderDetailTitle').textContent = detail.platformOrderNo; document.querySelector('#orderDetailMeta').textContent = `${detail.merchantName} · ${detail.subjectName} · ${detail.channelId}`;
  const canHandle = !['SUCCESS', 'CLOSED'].includes(detail.status);
  const actions = `<div class="order-detail-actions"><strong>订单操作</strong><button class="table-button danger-item" data-member-block-order-id="${esc(detail.id)}">拉黑</button>${canHandle ? `<button class="table-button" data-exception-action="QUERY" data-exception-order-id="${esc(detail.id)}">立即查单</button><button class="table-button" data-exception-action="CLOSE" data-exception-order-id="${esc(detail.id)}">确认关单</button><button class="table-button" data-exception-action="MARK_UNKNOWN" data-exception-order-id="${esc(detail.id)}">标记状态未知</button>` : ''}</div>`;
  const actionRows = detail.exceptionActions?.length ? detail.exceptionActions.map((item) => `<tr><td>${labelOf(item.action)}</td><td>${statusTag(item.result)}</td><td>${esc(item.operator || '-')}</td><td>${esc(item.note || '-')}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无异常处理记录</td></tr>';
  body.innerHTML = `${actions}<div class="order-detail-summary"><article><span>金额</span><strong>¥${money(detail.amount)}</strong></article><article><span>状态</span><strong>${statusTag(detail.status)}</strong></article><article><span>微信交易号</span><strong class="mono">${esc(detail.transactionId || '-')}</strong></article><article><span>创建时间</span><strong>${date(detail.createdAt)}</strong></article></div><div class="order-detail-grid"><div><h3>订单信息</h3><p>平台订单号：<span class="mono">${esc(detail.platformOrderNo)}</span></p><p>码商订单号：<span class="mono">${esc(detail.channelOutTradeNo)}</span></p><p>客户请求号：<span class="mono">${esc(detail.clientRequestNo)}</span></p><p>描述：${esc(detail.description)}</p><p>二维码有效期：${date(detail.expireAt)}</p></div><div><h3>通道信息</h3><p>主体：${esc(detail.subjectName)}</p><p>AppID：<span class="mono">${esc(detail.appId)}</span></p><p>商户号：<span class="mono">${esc(detail.mchId)}</span></p><p>凭证引用：<span class="mono">${esc(detail.credentialRef)}</span></p><p>回调路径：<span class="mono">${esc(detail.notifyPath)}</span></p></div><div><h3>设备信息</h3>${deviceInfoCell(detail)}</div><div class="channel-detail-card"><h3>路由分配</h3><p>规则：<span class="mono">${esc(detail.routeRuleId || detail.routeAllocation?.ruleId || "按默认规则")}</span></p><p>码商：<span class="mono">${esc(detail.routeAllocation?.platformMerchantId || detail.routeSnapshot?.platformMerchantId || "传统通道")}</span></p><p>微信商户号：<span class="mono">${esc(detail.routeAllocation?.wechatMerchantId || detail.wechatMerchantId || "-")}</span></p><p>容量状态：${statusTag(detail.routeAllocation?.status || "已记录")}</p></div></div><h3 class="subsection-title">状态时间线</h3><div class="order-timeline">${detail.events?.length ? detail.events.map((event) => `<div><span>${date(event.createdAt)}</span><strong>${labelOf(event.eventType)} ${event.fromStatus ? `${labelOf(event.fromStatus)} → ` : ''}${labelOf(event.toStatus || '')}</strong><small>${esc(JSON.stringify(event.detail || {}))}</small></div>`).join('') : '<p class="empty-cell">暂无状态事件</p>'}</div><h3 class="subsection-title">支付尝试</h3><div class="table-wrap"><table><thead><tr><th>通道</th><th>结果</th><th>错误码/交易态</th><th>时间</th></tr></thead><tbody>${detail.attempts?.length ? detail.attempts.map((item) => `<tr><td>${esc(item.channelId)}</td><td>${statusTag(item.status)}</td><td>${esc(item.errorCode || '-')}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">暂无支付尝试</td></tr>'}</tbody></table></div><h3 class="subsection-title">异常处理记录</h3><div class="table-wrap"><table><thead><tr><th>动作</th><th>结果</th><th>操作人</th><th>说明</th><th>时间</th></tr></thead><tbody>${actionRows}</tbody></table></div><h3 class="subsection-title">回调与退款</h3><p class="hint">回调 ${detail.callbacks?.length || 0} 条，退款 ${detail.refunds?.length || 0} 笔</p>`;
  document.querySelector('#orderDetailModal').classList.remove('hidden');
}
async function openOrderDetail(id) { const [detail, route] = await Promise.all([api(`/api/v1/admin/orders/${encodeURIComponent(id)}/detail`), api(`/api/v1/admin/orders/${encodeURIComponent(id)}/route`)]); state.orderDetail = detail.data; state.orderDetail.routeAllocation = route.data; renderOrderDetail(); }
function closeOrderSupplementModal() { document.querySelector('#orderSupplementModal')?.classList.add('hidden'); }
function openOrderSupplementModal(id) {
  const order = state.orders.find((item) => String(item.id) === String(id));
  const modal = document.querySelector('#orderSupplementModal'); const form = document.querySelector('#orderSupplementForm');
  if (!order || !modal || !form) return;
  form.reset(); form.elements.orderId.value = order.id;
  document.querySelector('#orderSupplementTitle').textContent = `订单补单 · ${order.platformOrderNo}`;
  document.querySelector('#orderSupplementMeta').textContent = `${order.merchantName || order.merchantId} · ¥${money(order.amount)} · 当前状态：${labelOf(order.status)}`;
  setMessage('orderSupplementMessage', '补单会将订单状态更新为支付成功，并触发商户回调。', false);
  modal.classList.remove('hidden');
  setTimeout(() => form.elements.operationPassword?.focus(), 0);
}
function refreshOrderFilters() {
  [['orderChannelFilter', state.channels, 'id', (item) => `${item.id} · ${item.subjectName}`], ['exceptionChannelFilter', state.channels, 'id', (item) => `${item.id} · ${item.subjectName}`], ['orderMerchantFilter', state.platformMerchants, 'id', (item) => `${item.name} · ${item.code}`], ['exceptionMerchantFilter', state.platformMerchants, 'id', (item) => `${item.name} · ${item.code}`]].forEach(([id, items, valueKey, label]) => { const node = document.querySelector(`#${id}`); if (!node) return; const current = node.value; node.innerHTML = `<option value="">全部${id.toLowerCase().includes('channel') ? '通道' : '码商'}</option>` + items.map((item) => `<option value="${esc(item[valueKey])}">${esc(label(item))}</option>`).join(''); if (current) node.value = current; });
}

function merchantPaymentSwitch(item) {
  const enabled = item.status === 'ACTIVE';
  const controllable = ['ACTIVE', 'SUSPENDED'].includes(item.status);
  const label = controllable ? (enabled ? '已开启' : '已关闭') : '管控锁定，不可开启';
  const switchText = !controllable ? '锁定' : (enabled ? '启用' : '停用');
  return `<div class="payment-switch-wrap"><button type="button" class="status-switch merchant-switch ${enabled ? 'on is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="${esc(item.name)}支付开关" ${controllable ? `data-platform-merchant-id="${esc(item.id)}" data-next-status="${enabled ? 'SUSPENDED' : 'ACTIVE'}"` : 'disabled'}>${switchText}<span></span></button><span class="subtle">${label}</span></div>`;
}

function platformMerchantRow(item) {
  const totalOrders = Number(item.orderCount || 0); const totalSuccess = Number(item.successCount || 0);
  const successRate = totalOrders ? Math.round(totalSuccess * 10000 / totalOrders) / 100 : 0;
  const prepaidBalance = Math.max(0, Number(item.quotaBalance || 0));
  const frozenPrepaid = Math.max(0, Number(item.quotaReserved || 0));
  const availablePrepaid = Math.max(0, prepaidBalance - frozenPrepaid);
  const prepaidEnabled = Number(item.quotaEnabled ?? 1) !== 0;
  const dayStats = (label, prefix) => `<div class="collection-day"><strong>${label}</strong><span>成功额 <b>¥${money(item[`${prefix}SuccessAmount`] || 0)}</b></span><span>失败额 <b>¥${money(item[`${prefix}FailureAmount`] || 0)}</b></span><span>成功单 <b>${item[`${prefix}SuccessCount`] || 0}</b></span><span>失败单 <b>${item[`${prefix}FailureCount`] || 0}</b></span><span>成功率 <b>${item[`${prefix}OrderCount`] ? Math.round(Number(item[`${prefix}SuccessCount`] || 0) * 10000 / Number(item[`${prefix}OrderCount`])) / 100 : 0}%</b></span></div>`;
  const prepaidCard = `<div class="prepaid-card"><div class="prepaid-toggle-line"><span>启用代收预付</span><button type="button" class="merchant-switch prepaid-switch ${prepaidEnabled ? 'on' : ''}" role="switch" aria-checked="${prepaidEnabled}" aria-label="${esc(item.name)}代收预付开关" data-platform-prepaid-toggle-id="${esc(item.id)}" data-next-enabled="${prepaidEnabled ? '0' : '1'}"><span></span></button></div><div class="prepaid-metric"><span>预付余额</span><strong>¥${money(prepaidBalance)}</strong></div><div class="prepaid-metric"><span>冻结额度</span><strong>¥${money(frozenPrepaid)}</strong></div><div class="prepaid-metric available"><span>可用预付</span><strong>¥${money(availablePrepaid)}</strong></div><div class="prepaid-relation">可用预付 = 预付余额 − 冻结额度</div><button type="button" class="prepaid-transfer" data-transfer-prepaid-id="${esc(item.id)}">转入预付</button></div>`;
  return `<tr><td><button class="text-button platform-merchant-name" data-platform-detail-id="${esc(item.id)}">${esc(item.name)}</button><div class="subtle mono platform-merchant-code">${esc(item.code)} · ${esc(item.id)}</div><div class="subtle">${esc(item.loginUsername || '未设置账号')}</div></td><td><div class="channel-count">${item.activeChannelCount || 0} 个可用通道</div><span class="subtle">最近活跃 ${date(item.lastActiveAt)}</span></td><td class="prepaid-cell">${prepaidCard}<div class="prepaid-source">可转入余额 ¥${money(item.availableBalance || 0)}</div></td><td class="payment-switch-cell">${merchantPaymentSwitch(item)}</td><td class="collection-cell"><div class="collection-card">${dayStats('昨日', 'yesterday')}${dayStats('今日', 'today')}<div class="collection-total"><span>总收款 <b>¥${money(item.successAmount || 0)}</b></span><span>成功率 <b>${successRate}%</b></span><span>每日限额 <b>${item.dailyAmountLimit ? `¥${money(item.dailyAmountLimit)}` : '不限'}</b></span></div></div></td><td><div class="platform-row-actions"><button class="table-button" data-adjust-platform-merchant-id="${esc(item.id)}">调额</button><button class="table-button" data-platform-detail-id="${esc(item.id)}">详情</button><button class="table-button" data-edit-platform-merchant-id="${esc(item.id)}">编辑</button><button class="table-button" data-bind-platform-merchant-id="${esc(item.id)}">配置通道</button></div></td></tr>`;
}

async function loadData() {
  ensurePlatformMerchantWorkspace();
  ensurePlatformMerchantDetailPanel();
  const dashboardFrom = document.querySelector('#dashboardDateFrom')?.value || dashboardToday(); const dashboardTo = document.querySelector('#dashboardDateTo')?.value || dashboardToday();
  const [clientMerchantsResponse, clientMerchantAgentsResponse, clientMerchantGroupsResponse] = await Promise.all([api('/api/v1/admin/client-merchants'), api('/api/v1/admin/client-merchant-agents'), api('/api/v1/admin/client-merchant-groups')]);
  const orderUrl = `/api/v1/admin/orders?${buildOrderQuery()}`; const exceptionUrl = `/api/v1/admin/exceptions?${buildOrderQuery(true)}`;
  const auditParams = new URLSearchParams({ limit: '200' });
  [['action', 'auditActionFilter'], ['operator', 'auditOperatorFilter'], ['target', 'auditTargetFilter'], ['dateFrom', 'auditDateFrom'], ['dateTo', 'auditDateTo']].forEach(([key, id]) => { const value = document.querySelector(`#${id}`)?.value?.trim(); if (value) auditParams.set(key, value); });
  const auditUrl = `/api/v1/admin/audit?${auditParams.toString()}`;
  const [health, metrics, overview, callbackConfig, readiness, bot, channels, channelHealth, subjects, apps, merchants, platformMerchants, orders, refunds, callbacks, callbackTasks, exceptions, rules, monitoring, consistency, audits, reconciliation, adminUsers, settlementStatements, qrCodes, qrChannelSettings, qrMonitoring, qrOrders, memberBlocks] = await Promise.all([
    api('/health'), api('/metrics'), api('/api/v1/admin/overview'), api('/api/v1/admin/callback-config'), api('/api/v1/admin/readiness'), api('/api/v1/admin/bot/settings'), api('/api/v1/admin/channels'), api('/api/v1/admin/channel-health'), api('/api/v1/admin/subjects'),
    api('/api/v1/admin/apps'), api('/api/v1/admin/merchants'), api('/api/v1/admin/platform-merchants'), api(orderUrl),
    api('/api/v1/admin/refunds?limit=100'), api('/api/v1/admin/callbacks?limit=100'), api('/api/v1/admin/callback-tasks?limit=100'), api(exceptionUrl),
    api('/api/v1/admin/routing-rules'), api('/api/v1/admin/monitoring'), api('/api/v1/admin/data-consistency'), api(auditUrl), api('/api/v1/admin/reconciliation/runs?limit=50'), api('/api/v1/admin/users'), api('/api/v1/admin/settlements?limit=100'), api('/api/v1/admin/qr-codes'), api('/api/v1/admin/qr-channel-settings'), api('/api/v1/admin/qr-monitoring'), api('/api/v1/admin/qr-orders?limit=50'), api('/api/v1/admin/member-blocks?limit=500')
  ]);
  state.health = health; state.metrics = metrics.data || {}; state.overview = overview.data; state.callbackConfig = callbackConfig.data || {}; state.readiness = readiness.data || {}; state.bot = bot.data || {}; state.channels = channels.data || []; state.channelHealth = channelHealth.data || []; state.subjects = subjects.data || [];
  const dashboardResponse = await api(`/api/v1/admin/dashboard?dateFrom=${encodeURIComponent(dashboardFrom)}&dateTo=${encodeURIComponent(dashboardTo)}`); state.dashboard = dashboardResponse.data || { totals: {}, daily: [] }; state.dashboardRange.from = dashboardFrom; state.dashboardRange.to = dashboardTo;
  const preflightEntries = await Promise.all(state.channels.map(async (channel) => { try { return [channel.id, (await api(`/api/v1/admin/channels/${encodeURIComponent(channel.id)}/preflight`)).data]; } catch { return [channel.id, {}]; } })); state.channelPreflights = Object.fromEntries(preflightEntries);
  state.apps = apps.data || []; state.merchants = merchants.data || []; state.clientMerchants = clientMerchantsResponse.data || []; state.clientMerchantAgents = clientMerchantAgentsResponse.data || []; state.clientMerchantGroups = clientMerchantGroupsResponse.data || []; state.platformMerchants = platformMerchants.data || []; state.orders = orders.data || []; state.ordersMeta = orders.meta || {}; state.ordersMetrics = orders.metrics || {};
  await loadPlatformMerchantFinance();
  state.refunds = refunds.data || []; state.callbacks = callbacks.data || []; state.callbackTasks = callbackTasks.data || []; state.exceptions = exceptions.data || []; state.exceptionsMeta = exceptions.meta || {}; state.exceptionMetrics = exceptions.metrics || {};
  state.rules = rules.data || []; state.monitoring = monitoring.data || []; state.consistency = consistency.data || null; state.audits = audits.data || [];
  state.reconciliation.runs = reconciliation.data || [];
  state.adminUsers = adminUsers.data || []; state.adminRoles = adminUsers.roles || [];
  state.settlementStatements = settlementStatements.data || [];
  state.qrCodes = qrCodes.data || [];
  state.qrChannelSettings = qrChannelSettings.data || [];
  state.qrMonitoring = { data: qrMonitoring.data || [], summary: qrMonitoring.summary || {} };
  state.qrOrders = qrOrders.data || [];
  state.memberBlocks = memberBlocks.data || [];
  const publicPaymentMonitoring = await api(`/api/v1/admin/public-payment-monitoring?hours=${encodeURIComponent(document.querySelector('#publicPaymentMonitorHours')?.value || '24')}`);
  state.publicPaymentMonitoring = publicPaymentMonitoring.data || { summary: {}, events: [], recent: [] };
  const qrFromInput = document.querySelector('#qrSettlementFrom'); const qrToInput = document.querySelector('#qrSettlementTo'); const qrToday = dashboardToday(); if (qrFromInput && !qrFromInput.value) qrFromInput.value = qrToday; if (qrToInput && !qrToInput.value) qrToInput.value = qrToday;
  const qrFrom = qrFromInput?.value || qrToday; const qrTo = qrToInput?.value || qrToday;
  try { const qrSettlement = await api(`/api/v1/admin/qr-settlement?dateFrom=${encodeURIComponent(qrFrom)}&dateTo=${encodeURIComponent(qrTo === qrFrom ? (() => { const d = new Date(`${qrTo}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })() : qrTo)}`); state.qrSettlement = { data: qrSettlement.data || [], summary: qrSettlement.summary || {} }; } catch { state.qrSettlement = { data: [], summary: {} }; }
  state.reconciliation.detail = state.reconciliation.runs[0] ? (await api(`/api/v1/admin/reconciliation/runs/${encodeURIComponent(state.reconciliation.runs[0].id)}`)).data : null;
  const dateFrom = document.querySelector('#reconciliationForm')?.elements.dateFrom.value;
  const dateTo = document.querySelector('#reconciliationForm')?.elements.dateTo.value;
  state.reconciliation.settlement = dateFrom && dateTo ? (await api(`/api/v1/admin/settlement/report?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`)).data || [] : [];
  document.querySelector('#sidebarMode').textContent = health.mockPayment ? '模拟支付模式' : '真实 APIv2 Native 模式';
  render();
}

function merchantAccountRow(item) {
  const enabled = item.status === 'ACTIVE';
  const monitorLocked = Number(item.monitorLocked ?? 0) === 1;
  const riskEnabled = Number(item.riskEnabled ?? 1) !== 0;
  const paymentSwitch = monitorLocked
    ? `<button type="button" class="status-switch merchant-enable-switch is-locked" role="switch" aria-checked="false" aria-label="商户号已被监控锁定" disabled>锁定<span></span></button><span class="subtle merchant-lock-label">管控锁定，不可开启</span>`
    : `<button type="button" class="status-switch merchant-enable-switch ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" data-merchant-id="${esc(item.id)}" data-next-status="${enabled ? 'DISABLED' : 'ACTIVE'}">${enabled ? '启用' : '停用'}<span></span></button><span class="subtle">${enabled ? '已启用' : '已停用'}</span>`;
  return `<tr>
    <td><input type="checkbox" data-merchant-select="${esc(item.id)}" aria-label="选择商户号 ${esc(item.mchid)}"></td>
    <td><strong class="mono">${esc(item.mchid)}</strong><br><span class="subtle mono">${esc(item.id)}</span></td>
    <td>${esc(item.subjectName)}<br><span class="subtle mono">${esc(item.subjectId)}</span></td>
    <td>${paymentSwitch}</td>
    <td><button type="button" class="merchant-enable-switch ${riskEnabled ? 'is-on' : ''}" role="switch" aria-checked="${riskEnabled}" data-merchant-risk-id="${esc(item.id)}" data-next-risk-enabled="${riskEnabled ? 0 : 1}"><span></span></button><span class="subtle">${riskEnabled ? '已启用' : '已关闭'}</span></td>
    <td><button type="button" class="inline-value-button" data-merchant-daily-limit="${esc(item.id)}">${Number(item.dailyAmountLimit || 0) > 0 ? `¥${money(item.dailyAmountLimit)}` : '不限'}</button></td>
    <td><strong>${Number(item.complaintCount || 0)}</strong></td>
    <td><strong>${item.todaySuccessRate ?? 0}%</strong><br><span class="subtle">${item.todaySuccessOrderCount || 0}/${item.todayOrderCount || 0} 成功</span></td>
    <td><strong>¥${money(item.todaySuccessAmount || 0)}</strong><br><span class="subtle">${item.todaySuccessOrderCount || 0} 笔</span></td>
    <td><strong>¥${money(item.yesterdaySuccessAmount || 0)}</strong><br><span class="subtle">${item.yesterdaySuccessOrderCount || 0} 笔</span></td>
    <td class="merchant-actions"><button type="button" class="table-button" data-merchant-copy="${esc(item.id)}">复制</button> <details class="row-more-menu"><summary class="table-button">操作 <span class="subtle">···</span></summary><div class="row-more-panel">
      <button type="button" class="row-more-item" data-merchant-stats="${esc(item.id)}">流水明细</button>
      <button type="button" class="row-more-item" data-merchant-payment-test="${esc(item.id)}">测试</button>
      <button type="button" class="row-more-item" data-merchant-risk-settings="${esc(item.id)}">风控设置</button>
      <button type="button" class="row-more-item danger-item ${monitorLocked ? '' : 'is-unavailable'}" data-merchant-force-enable="${esc(item.id)}" ${monitorLocked ? '' : 'disabled'} title="${monitorLocked ? '解除监控锁定并恢复收款' : '仅监控锁定状态可用'}">管理员强制开启${monitorLocked ? '' : '（监控锁定时可用）'}</button>
      <button type="button" class="row-more-item" data-merchant-edit="${esc(item.id)}">编辑</button>
      <button type="button" class="row-more-item" data-bind-channels-for-merchant="${esc(item.id)}">绑定通道</button>
      <button type="button" class="row-more-item danger-item" data-merchant-delete="${esc(item.id)}">删除</button>
    </div></details></td>
  </tr>`;
}

function clientMerchantRow(item, index) {
  const warning = Number(item.balanceWarningAmount || 0) > 0 && Number(item.balance || 0) <= Number(item.balanceWarningAmount || 0);
  const enabled = item.status === 'ACTIVE';
  const statusSwitch = '<div class="payment-switch-wrap"><button type="button" class="status-switch client-status-switch ' + (enabled ? 'is-on' : '') + '" role="switch" aria-checked="' + enabled + '" aria-label="' + esc(item.name) + '商户开关" data-client-list-status-id="' + esc(item.id) + '" data-next-client-status="' + (enabled ? 'DISABLED' : 'ACTIVE') + '">' + (enabled ? '启用' : '停用') + '<span></span></button><span class="subtle">' + (enabled ? '已启用' : '已停用') + '</span></div>';
  return '<tr><td><input type="checkbox" data-client-select="' + esc(item.id) + '"></td><td>' + (index + 1) + '</td><td><strong class="mono">' + esc(item.code) + '</strong><br><span class="subtle mono">' + esc(item.id) + '</span></td><td><button class="text-button" data-client-detail-id="' + esc(item.id) + '">' + esc(item.name) + '</button><div class="subtle">' + (item.groupName || '未分组') + ' · ' + (item.channelCount || 0) + ' 个通道</div></td><td class="money-positive">¥' + money(item.balance) + (warning ? '<br><span class="status paused">余额预警</span>' : '') + '</td><td class="money-negative">¥' + money(item.frozenAmount) + '</td><td>¥' + money(item.prepaidAmount) + '</td><td>¥' + money(item.settlementAmount) + '</td><td>' + Number(item.withdrawalFee || 0).toFixed(2) + '%</td><td>' + statusSwitch + '</td><td>' + esc(item.agentName || '-') + '</td><td>' + Number(item.profitShare || 0).toFixed(2) + '%</td><td class="mono">' + esc(item.loginUsername || '-') + '</td><td>' + date(item.createdAt) + '</td><td class="client-actions"><button class="table-button" data-edit-client-id="' + esc(item.id) + '">编辑</button> <button class="table-button" data-client-detail-id="' + esc(item.id) + '">通道绑定</button> <span class="more-menu"><button class="table-button" data-client-more-toggle="' + esc(item.id) + '">更多⌄</button><span class="more-menu-list"><button data-client-detail-id="' + esc(item.id) + '">详情</button><button data-client-connect="' + esc(item.id) + '">对接信息</button><button data-rotate-client-key="' + esc(item.id) + '">重置 API Key</button><button data-client-detail-id="' + esc(item.id) + '">资金流水</button><button data-client-detail-id="' + esc(item.id) + '">操作日志</button></span></span></td></tr>';
}
function renderClientMerchants() {
  const q = String(document.querySelector('#clientMerchantSearch')?.value || '').trim().toLowerCase();
  const status = document.querySelector('#clientMerchantStatusFilter')?.value || '';
  const rows = state.clientMerchants.filter((item) => (!status || item.status === status) && (!q || [item.code, item.name, item.agentName, item.loginUsername, item.id].some((value) => String(value || '').toLowerCase().includes(q))));
  const total = state.clientMerchants.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const prepaid = state.clientMerchants.reduce((sum, item) => sum + Number(item.prepaidAmount || 0), 0);
  const settlement = state.clientMerchants.reduce((sum, item) => sum + Number(item.settlementAmount || 0), 0);
  setText('clientMerchantMetricTotal', state.clientMerchants.length); setText('clientMerchantMetricActive', state.clientMerchants.filter((item) => item.status === 'ACTIVE').length); setText('clientMerchantMetricBalance', '¥' + money(total)); setText('clientMerchantMetricPrepaid', '¥' + money(prepaid)); setText('clientMerchantMetricSettlement', '¥' + money(settlement));
  setText('clientMerchantTotalBalance', '¥' + money(rows.reduce((sum, item) => sum + Number(item.balance || 0), 0))); setText('clientMerchantTotalFrozen', '¥' + money(rows.reduce((sum, item) => sum + Number(item.frozenAmount || 0), 0))); setText('clientMerchantTotalPrepaid', '¥' + money(rows.reduce((sum, item) => sum + Number(item.prepaidAmount || 0), 0))); setText('clientMerchantTotalSettlement', '¥' + money(rows.reduce((sum, item) => sum + Number(item.settlementAmount || 0), 0)));
  const tbody = document.querySelector('#clientMerchantRows'); if (tbody) tbody.innerHTML = rows.length ? rows.map(clientMerchantRow).join('') : '<tr><td colspan="15" class="empty-cell">暂无匹配商户</td></tr>';
}
function ensureClientMerchantModal() {
  if (document.querySelector('#clientMerchantModal')) return;
  document.body.insertAdjacentHTML('beforeend', '<div id="clientMerchantModal" class="modal-backdrop hidden"><div class="modal-card client-merchant-modal-card client-merchant-form-drawer"><div class="section-title"><div><div class="eyebrow">CLIENT MERCHANT</div><h3 id="clientMerchantModalTitle">创建商户信息</h3></div><button type="button" class="ghost-button" data-close-client-modal>×</button></div><form id="clientMerchantForm" class="form-grid"><input type="hidden" name="code"><label>商户名称<span class="required-mark">*</span><input name="name" required maxlength="120" placeholder="商户名称"></label><label>提现手续费（%）<span class="required-mark">*</span><input name="withdrawalFee" type="number" min="0" max="100" step="0.01" value="0" required></label><label>代理名称<select name="agentName"><option value="">未分配代理</option></select></label><label>商户分组<select name="groupName"><option value="">未分组</option></select><input type="hidden" name="groupId" value="0"></label><label class="form-span-2">登录IP白名单<textarea name="loginIpAllowlist" rows="3" placeholder="登录IP白名单"></textarea><small>多个请用“|”分割，留空表示不限制</small></label><label class="form-span-2">提现IP白名单<textarea name="withdrawIpAllowlist" rows="3" placeholder="提现IP白名单"></textarea><small>多个请用“|”分割，留空表示不限制</small></label><label><span class="required-mark">*</span>群组ID<input name="groupIdText" value="0" required pattern="[A-Za-z0-9_-]{1,64}" placeholder="0"></label><label><span class="required-mark">*</span>商户余额预警（分）<input name="balanceWarningAmount" type="number" min="0" step="1" value="0" required><small>为 0 则不预警</small></label><label>商户单笔限额（分）<input name="singleOrderLimit" type="number" min="0" step="1" value="0"><small>为 0 则不限额</small></label><label>商户日限额（分）<input name="dailyAmountLimit" type="number" min="0" step="1" value="0"><small>为 0 则不限额</small></label><label class="form-span-2">登录账号<span class="required-mark">*</span><input name="loginUsername" required maxlength="16" minlength="3" pattern="[A-Za-z0-9]{3,16}" placeholder="登录账号"><small>仅支持 3-16 位字母和数字</small></label><label class="form-span-2">登录密码<span class="required-mark">*</span><input name="password" type="password" minlength="8" maxlength="128" placeholder="首次登录密码"><small>至少 8 位；编辑时留空表示不修改</small></label><label>结算比例（%）<input name="settlementRate" type="number" min="0" max="100" step="0.01" value="0"></label><label>分润比例（%）<input name="profitShare" type="number" min="0" max="100" step="0.01" value="0"></label><div class="form-actions"><button type="button" class="ghost-button" data-close-client-modal>取消</button><button class="primary-button" type="submit">✓ 确定</button></div></form><p id="clientMerchantFormMessage" class="message"></p></div></div>');
}
function openClientMerchantModal(item) { ensureClientMerchantModal(); const modal=document.querySelector('#clientMerchantModal'); const form=document.querySelector('#clientMerchantForm'); form.reset(); form.dataset.editingId=item?.id || ''; form.elements.password.required=!item; const agentSelect=form.elements.agentName; const groupSelect=form.elements.groupName; const currentAgent=item?.agentName || ''; const currentGroup=item?.groupName || ''; agentSelect.innerHTML='<option value="">未分配代理</option>'+state.clientMerchantAgents.map((x)=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join(''); groupSelect.innerHTML='<option value="">未分组</option>'+state.clientMerchantGroups.map((x)=>'<option value="'+esc(x.name)+'">'+esc(x.name)+'</option>').join(''); if (currentAgent && ![...agentSelect.options].some((x)=>x.value===currentAgent)) agentSelect.insertAdjacentHTML('beforeend','<option value="'+esc(currentAgent)+'">'+esc(currentAgent)+'（历史）</option>'); if (currentGroup && ![...groupSelect.options].some((x)=>x.value===currentGroup)) groupSelect.insertAdjacentHTML('beforeend','<option value="'+esc(currentGroup)+'">'+esc(currentGroup)+'（历史）</option>'); document.querySelector('#clientMerchantModalTitle').textContent=item ? '编辑商户信息' : '创建商户信息'; if (item) Object.entries({code:item.code,name:item.name,loginUsername:item.loginUsername,agentName:item.agentName,groupId:item.groupId,groupName:item.groupName,loginIpAllowlist:item.loginIpAllowlist,withdrawIpAllowlist:item.withdrawIpAllowlist,groupIdText:item.groupId,balanceWarningAmount:item.balanceWarningAmount,singleOrderLimit:item.singleOrderLimit,dailyAmountLimit:item.dailyAmountLimit,settlementRate:item.settlementRate,profitShare:item.profitShare,withdrawalFee:item.withdrawalFee}).forEach(([key,value]) => { if (form.elements[key]) form.elements[key].value=value ?? ''; }); modal.classList.remove('hidden'); }
async function openClientMerchantDetail(id) {
  const detail = (await api('/api/v1/admin/client-merchants/' + encodeURIComponent(id))).data;
  let panel = document.querySelector('#clientMerchantDetailDrawer');
  if (!panel) { document.body.insertAdjacentHTML('beforeend', '<div id="clientMerchantDetailDrawer" class="client-merchant-drawer hidden"><div class="client-merchant-drawer-card"><div class="section-title"><div><div class="eyebrow">MERCHANT DETAIL</div><h3 id="clientMerchantDetailTitle"></h3><p id="clientMerchantDetailMeta" class="hint"></p></div><button class="ghost-button" data-close-client-detail>关闭</button></div><div id="clientMerchantDetailBody"></div></div></div>'); panel = document.querySelector('#clientMerchantDetailDrawer'); }
  const ledger = detail.ledger || []; const channels = detail.channels || []; const boundIds = new Set(channels.map((x) => String(x.channelId || x.id)));
  const channelSettings = new Map(channels.map((x) => [String(x.channelId || x.id), x]));
  const availableChannels = state.channels.map((x) => { const setting = channelSettings.get(String(x.id)); const strategy = String(setting?.routeStrategy || x.routeStrategy || 'HEALTH_WEIGHTED'); return '<label class="channel-option"><input type="checkbox" value="' + esc(x.id) + '" ' + (boundIds.has(String(x.id)) ? 'checked' : '') + '><span class="channel-option-body"><span class="channel-option-title">' + esc(x.id) + ' · ' + esc(x.subjectName) + '</span><span class="channel-option-meta">' + esc(x.appId) + ' · ' + esc(x.mchId) + '</span><span class="channel-option-route"><span class="subtle">路由策略</span><select class="inline-select" data-client-channel-route-strategy="' + esc(x.id) + '"><option value="HEALTH_WEIGHTED" ' + (strategy === 'HEALTH_WEIGHTED' ? 'selected' : '') + '>健康加权</option><option value="ROUND_ROBIN" ' + (strategy === 'ROUND_ROBIN' ? 'selected' : '') + '>轮询</option><option value="FAILOVER" ' + (strategy === 'FAILOVER' ? 'selected' : '') + '>故障转移</option></select></span></span></label>'; }).join('');
  document.querySelector('#clientMerchantDetailTitle').textContent = detail.name; document.querySelector('#clientMerchantDetailMeta').textContent = detail.code + ' · ' + (detail.loginUsername || '未设置登录账号');
  document.querySelector('#clientMerchantDetailBody').innerHTML = '<div class="client-merchant-detail-grid">' + [['余额', '¥' + money(detail.balance)], ['冻结', '¥' + money(detail.frozenAmount)], ['预付款', '¥' + money(detail.prepaidAmount)], ['待结算', '¥' + money(detail.settlementAmount)], ['今日收款', '¥' + money(detail.todaySuccessAmount)], ['今日成功率', (detail.todaySuccessRate ?? 0) + '%']].map(([k, v]) => '<article><span>' + k + '</span><strong>' + v + '</strong></article>').join('') + '</div><div class="inline-tools detail-actions"><button class="primary-button" data-adjust-client-id="' + esc(detail.id) + '" data-adjust-action="ADD">增加余额</button><button class="ghost-button" data-adjust-client-id="' + esc(detail.id) + '" data-adjust-action="SUBTRACT">减少余额</button><button class="ghost-button" data-client-status-id="' + esc(detail.id) + '" data-next-client-status="' + (detail.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE') + '">' + (detail.status === 'ACTIVE' ? '停用商户' : '启用商户') + '</button></div><h3 class="subsection-title">资金流水</h3><div class="table-wrap client-merchant-ledger"><table><thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>说明</th></tr></thead><tbody>' + (ledger.length ? ledger.map((x) => '<tr><td>' + date(x.createdAt) + '</td><td>' + esc(x.entryType) + '</td><td>' + ((Number(x.amount) >= 0 ? '+' : '') + money(x.amount)) + '</td><td>' + money(x.balanceAfter) + '</td><td>' + esc(x.note || '-') + '</td></tr>').join('') : '<tr><td colspan="5" class="empty-cell">暂无流水</td></tr>') + '</tbody></table></div><h3 class="subsection-title">已绑定通道（' + channels.length + '）</h3><div class="tag-list">' + (channels.length ? channels.map((x) => '<span class="tag">' + esc(x.channelId || x.id) + ' · ' + esc(x.subjectName || '') + '</span>').join('') : '<span class="subtle">尚未绑定通道，未设置时将使用全部可用通道</span>') + '</div><h3 class="subsection-title">绑定通道</h3><div class="channel-option-list" id="clientChannelOptions">' + (availableChannels || '<span class="subtle">暂无可用通道</span>') + '</div><div class="form-actions"><button class="primary-button" data-save-client-channels="' + esc(detail.id) + '">保存通道绑定</button></div>';
  panel.classList.remove('hidden');
}

function merchantCredentialState(item) {
  return item?.credentialRef ? 'READY' : 'NOT_READY';
}

let merchantMonitorRefreshInFlight = false;
async function refreshMerchantMonitorState() {
  if (merchantMonitorRefreshInFlight || document.hidden) return;
  merchantMonitorRefreshInFlight = true;
  try {
    const response = await api('/api/v1/admin/merchants');
    state.merchants = response.data || [];
    render();
  } catch {
    // 后台轮询失败不打断当前页面操作，下一次周期继续刷新。
  } finally {
    merchantMonitorRefreshInFlight = false;
  }
}
function openClientIntegration(id) {
  const merchant = state.clientMerchants.find((item) => String(item.id) === String(id)); if (!merchant) return;
  const baseUrl = state.callbackConfig?.publicBaseUrl || window.location.origin;
  const merchantId = String(id); const rawApiKey = state.clientApiKeys[merchantId] || ''; const rawPassword = modalPasswordCache[merchantId] || '';
  const visibility = integrationVisibility[merchantId] || { password: false, secret: false };
  const apiKey = rawApiKey || '请使用“重置 API Key”生成新的商户秘钥';
  const loginUrl = `${baseUrl}/client`;
  const passwordDisplay = rawPassword ? (visibility.password ? rawPassword : '******') : '******（点击“重置登录密码”生成新密码）';
  const secretDisplay = rawApiKey ? (visibility.secret ? rawApiKey : '******') : apiKey;
  const compose = (password, secret) => [
    '对接信息',
    '',
    `商户登录地址：${loginUrl}`,
    `登录名：${merchant.loginUsername || '-'}`,
    `登录密码：${password}`,
    `商户号：${merchant.code}`,
    `商户秘钥：${secret}`,
    '',
    '──────── 代收 ────────',
    '',
    `下单接口：${baseUrl}/api/v1/orders`,
    `查单接口：${baseUrl}/api/v1/orders/{platformOrderNo}`,
    '',
    '请求头：',
    `x-merchant-code：${merchant.code}`,
    `x-merchant-key：${secret}`,
    'content-type：application/json',
    '',
    '回调地址：请在商户工作台配置，平台会按订单状态发送通知'
  ].join('\n');
  const text = compose(rawPassword || '******（点击“重置登录密码”生成新密码）', rawApiKey || apiKey);
  const displayText = compose(passwordDisplay, secretDisplay);
  let modal = document.querySelector('#clientIntegrationModal'); if (!modal) { document.body.insertAdjacentHTML('beforeend', '<div id="clientIntegrationModal" class="modal-backdrop hidden"><div class="modal-card integration-modal-card"><div class="section-title"><div><div class="eyebrow">CLIENT INTEGRATION</div><h3 id="clientIntegrationTitle">对接信息</h3><p class="hint">按商户对接资料格式展示，支持复制全部内容。</p></div><button class="ghost-button" data-close-client-integration>关闭</button></div><div class="integration-warning">商户秘钥只在创建或重置时显示一次。请将明文秘钥保存到服务端环境变量，不要提交到前端或代码仓库。</div><div class="integration-visibility-tools"><button class="ghost-button" data-toggle-client-password>' + (visibility.password ? '隐藏商户密码' : '显示商户密码') + '</button><button class="ghost-button" data-toggle-client-secret>' + (visibility.secret ? '隐藏商户秘钥' : '显示商户秘钥') + '</button></div><pre id="clientIntegrationJson" class="integration-code"></pre><div class="form-actions"><button class="ghost-button" data-reset-client-password>重置登录密码</button><button class="primary-button" data-copy-client-integration>一键复制对接信息</button></div><p id="clientIntegrationMessage" class="message"></p></div></div>'); modal = document.querySelector('#clientIntegrationModal'); }
  modal.dataset.integrationText = text; modal.dataset.integrationMerchantId = merchantId; modal.querySelector('#clientIntegrationTitle').textContent = `${merchant.name} · 对接信息`; modal.querySelector('#clientIntegrationJson').textContent = displayText; modal.querySelector('[data-toggle-client-password]').textContent = visibility.password ? '隐藏商户密码' : '显示商户密码'; modal.querySelector('[data-toggle-client-secret]').textContent = visibility.secret ? '隐藏商户秘钥' : '显示商户秘钥'; modal.classList.remove('hidden');
}

function renderBot() {
  const b = state.bot || {}; const n = b.notificationSettings || {}; const t = b.thresholds || {};
  const setChecked = (id, value) => { const node = document.querySelector('#' + id); if (node) node.checked = Boolean(value); };
  const setValue = (id, value) => { const node = document.querySelector('#' + id); if (node && document.activeElement !== node) node.value = value ?? ''; };
  setChecked('botEnabled', b.enabled); setChecked('botReportEnabled', b.reportEnabled); setChecked('botNotifyChannelCircuit', n.channelCircuit); setChecked('botNotifyChannelFailure', n.channelFailure); setChecked('botNotifyCallbackFailure', n.callbackFailure); setChecked('botNotifyLowBalance', n.lowBalance); setChecked('botNotifyComplaint', n.complaint);
  setValue('botAdminGroupId', b.adminGroupId); setValue('botWebhookUrl', b.webhookUrl); setValue('botReportTime', b.reportTime || '23:30'); setValue('botFailureThreshold', t.channelFailureCount ?? 3); setValue('botCallbackThreshold', t.callbackFailureCount ?? 3); setValue('botLowBalanceThreshold', t.lowBalanceAmount ?? 0);
  const groups = document.querySelector('#botGroupRows'); if (groups) groups.innerHTML = (b.groups || []).length ? b.groups.map((g) => `<tr><td>${esc(g.name)}</td><td class="mono">${esc(g.chatId)}</td><td>${esc(g.scopeType)}${g.scopeId ? ` · ${esc(g.scopeId)}` : ''}</td><td>${g.enabled ? '启用' : '停用'}</td><td><button class="table-button" data-bot-group-toggle="${esc(g.id)}" data-next-enabled="${g.enabled ? 'false' : 'true'}">${g.enabled ? '停用' : '启用'}</button> <button class="table-button danger-item" data-bot-group-delete="${esc(g.id)}">删除</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无接收群组</td></tr>';
  const commands = document.querySelector('#botCommandRows'); if (commands) commands.innerHTML = (b.commands || []).map((item) => `<tr><td class="mono">${esc(item.command)}</td><td>${esc(item.description)}</td></tr>`).join('');
  const operators = document.querySelector('#botOperatorRows'); if (operators) operators.innerHTML = (b.operators || []).length ? b.operators.map((item) => `<tr><td class="mono">${esc(item.chatId)}</td><td class="mono">${esc(item.userId)}</td><td>${esc(item.username || '-')}</td><td><button class="table-button danger-item" data-bot-operator-delete="${esc(item.chatId)}" data-bot-operator-user="${esc(item.userId)}">删除</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">暂无操作员</td></tr>';
  const logs = document.querySelector('#botLogRows'); if (logs) logs.innerHTML = (b.logs || []).length ? b.logs.map((item) => `<tr><td>${date(item.createdAt)}</td><td class="mono">${esc(item.chatId)}</td><td>${esc(item.eventType)}</td><td>${esc(item.status)}</td><td>${esc(item.message)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无发送记录</td></tr>';
}
function dashboardToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); }
function dashboardDateOffset(days) { const d = new Date(`${dashboardToday()}T00:00:00+08:00`); return new Date(d.getTime() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); }
function renderDashboard() {
  const totals = state.dashboard?.totals || {};
  setText('dashboardUpdatedAt', `最后更新 ${new Date().toLocaleTimeString()}`);
  setText('dashboardGrossAmount', `¥${money(totals.grossAmount || 0)}`); setText('dashboardSuccessRate', `${Number(totals.successRate || 0)}%`); setText('dashboardRefundAmount', `¥${money(totals.refundAmount || 0)}`);
  const pendingSettlement = state.platformMerchants.reduce((sum, item) => sum + Number(item.pendingSettlement || 0), 0); setText('dashboardPendingSettlement', `¥${money(pendingSettlement)}`);
  const exceptionCount = Number(state.exceptionMetrics?.totalCount || state.exceptionsMeta?.total || state.exceptions?.length || 0) + state.monitoring.filter((item) => String(item.circuitState) === 'OPEN').length + state.callbackTasks.filter((item) => ['PENDING', 'RETRYING'].includes(String(item.status))).length;
  setText('dashboardAlertCount', exceptionCount); setText('dashboardAlertHint', exceptionCount ? '需要运营处理' : '暂无待处理异常'); setText('dashboardRangeLabel', state.dashboardRange.label);
  const previous = state.dashboard?.daily?.[Math.max(0, state.dashboard.daily.length - 2)]; const current = state.dashboard?.daily?.[state.dashboard.daily.length - 1];
  const trend = (current && previous && Number(previous.grossAmount)) ? `${Number(((Number(current.grossAmount) - Number(previous.grossAmount)) * 100 / Number(previous.grossAmount)).toFixed(1))}% 较前一日` : '暂无对比数据'; setText('dashboardGrossTrend', trend); setText('dashboardSuccessTrend', `${Number(totals.orderCount || 0)} 笔订单`); setText('dashboardRefundTrend', `${Number(totals.refundAmount || 0) ? '需关注退款' : '暂无退款'}`);
  const alerts = [];
  state.monitoring.filter((item) => String(item.circuitState) === 'OPEN').slice(0, 3).forEach((item) => alerts.push({ type: 'danger', title: `通道 ${item.channelId} 已熔断`, detail: `连续失败 ${item.consecutiveFailures || 0} 次`, view: 'channels' }));
  state.exceptions.slice(0, 3).forEach((item) => alerts.push({ type: 'warning', title: item.platformOrderNo || '异常订单', detail: item.status === 'UNKNOWN' ? '支付状态未知，建议立即查单' : '存在待处理异常', view: 'exceptions' }));
  state.callbackTasks.filter((item) => ['PENDING', 'RETRYING'].includes(String(item.status))).slice(0, 2).forEach((item) => alerts.push({ type: 'info', title: '回调任务待处理', detail: item.channelId || item.id, view: 'callbacks' }));
  if (!alerts.length) alerts.push({ type: 'success', title: '系统运行正常', detail: '当前没有需要处理的异常事项', view: 'monitoring' });
  const alertNode = document.querySelector('#dashboardAlerts'); if (alertNode) alertNode.innerHTML = alerts.slice(0, 6).map((item) => `<button class="dashboard-alert ${item.type}" data-go="${esc(item.view)}"><span class="dashboard-alert-dot"></span><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><b>›</b></button>`).join('');
  const trendNode = document.querySelector('#dashboardTrend'); const daily = state.dashboard?.daily || []; const maxAmount = Math.max(1, ...daily.map((item) => Number(item.grossAmount || 0))); if (trendNode) trendNode.innerHTML = daily.length ? daily.map((item) => `<div class="trend-row"><span>${esc(String(item.date).slice(5))}</span><div class="trend-track"><i style="width:${Math.max(3, Number(item.grossAmount || 0) * 100 / maxAmount)}%"></i></div><strong>¥${money(item.grossAmount || 0)}</strong><small>${item.successRate || 0}%</small></div>`).join('') : '<div class="empty-cell">暂无趋势数据</div>';
}
function initializeDashboardRange() { const from = document.querySelector('#dashboardDateFrom'); const to = document.querySelector('#dashboardDateTo'); if (!from || !to) return; from.value = dashboardToday(); to.value = dashboardToday(); state.dashboardRange = { from: from.value, to: to.value, label: '今日' }; }
function qrStatusLabel(value) { return { ACTIVE: '启用', PAUSED: '暂停', DISABLED: '停用' }[String(value)] || value || '-'; }
function renderQrViews() {
  const query = String(document.querySelector('#qrCodeSearch')?.value || '').trim().toLowerCase(); const status = document.querySelector('#qrCodeStatusFilter')?.value || '';
  const codes = state.qrCodes.filter((item) => (!status || item.status === status) && (!query || [item.name, item.payload, item.ownerId, item.channelId].some((v) => String(v || '').toLowerCase().includes(query))));
  setText('qrMetricTotal', state.qrCodes.length); setText('qrMetricActive', state.qrCodes.filter((x) => x.status === 'ACTIVE').length); setText('qrMetricBound', state.qrCodes.filter((x) => x.channelId).length); setText('qrMetricPaused', state.qrCodes.filter((x) => x.status !== 'ACTIVE').length);
  const assignSelect = document.querySelector('#qrBatchChannelSelect'); if (assignSelect) assignSelect.innerHTML = '<option value="">批量分配通道…</option>' + state.channels.map((x) => `<option value="${esc(x.id)}">${esc(x.id)} · ${x.merchantCount ?? x.merchantIds?.length ?? 0} 个商户</option>`).join('');
  const importSelect = document.querySelector('#qrImportChannel'); if (importSelect) importSelect.innerHTML = '<option value="">不绑定，稍后分配</option>' + state.channels.map((x) => `<option value="${esc(x.id)}">${esc(x.id)} · ${x.merchantCount ?? x.merchantIds?.length ?? 0} 个商户</option>`).join('');
  const rows = document.querySelector('#qrCodeRows'); if (rows) rows.innerHTML = codes.length ? codes.map((item) => `<tr><td><input type="checkbox" data-qr-select="${esc(item.id)}" aria-label="选择 ${esc(item.name)}"></td><td><strong>${esc(item.name)}</strong><br><span class="subtle mono">${esc(String(item.payload).slice(0, 42))}${String(item.payload).length > 42 ? '…' : ''}</span></td><td class="mono">${esc(item.channelId || '未分配')}</td><td>${esc(item.ownerId || '平台')}</td><td>${statusTag(item.status)}<br><span class="subtle">${qrStatusLabel(item.status)}</span></td><td>${item.orderWindowSeconds ? `${item.orderWindowSeconds} 秒 / ${item.orderWindowLimit || '不限'} 笔` : '按通道策略'}<br><span class="subtle">今日 ${item.todayOrderCount || 0} 笔 / ¥${money(item.todayAmount || 0)}</span></td><td>${date(item.lastUsedAt)}</td><td><button class="table-button" data-qr-test="${esc(item.id)}">测试</button> <button class="table-button" data-qr-pause="${esc(item.id)}" data-next-qr-status="${item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}">${item.status === 'ACTIVE' ? '暂停' : '启用'}</button> <button class="table-button danger-text" data-qr-delete="${esc(item.id)}">删除</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">暂无收款码，请先批量导入</td></tr>';
  const channelRows = document.querySelector('#qrChannelRows'); if (channelRows) channelRows.innerHTML = state.qrChannelSettings.length ? state.qrChannelSettings.map((item) => `<tr><td class="mono">${esc(item.channelId)}</td><td>${item.merchantCount ?? 0} 个</td><td><button class="merchant-enable-switch ${Number(item.enabled) ? 'is-on' : ''}" data-qr-channel-toggle="${esc(item.channelId)}" data-next-qr-enabled="${Number(item.enabled) ? 0 : 1}"><span></span></button><span class="subtle">${Number(item.enabled) ? '已启用' : '已关闭'}</span></td><td><input class="binding-inline-input" data-qr-channel-weight="${esc(item.channelId)}" type="number" min="1" value="${Number(item.routeWeight || 100)}"></td><td>${item.qrCodeCount || 0}</td><td>${item.dailyOrderLimit ? `日 ${item.dailyOrderLimit} 笔` : '日不限'}<br>${item.orderWindowSeconds ? `${item.orderWindowSeconds} 秒/${item.orderWindowLimit || '不限'} 笔` : '窗口不限'}<br><span class="subtle">自动暂停 ${Number(item.autoPauseEnabled) ? (item.failureRateThreshold ? `${item.failureRateThreshold}%` : '已开') : '仅提醒'}</span></td><td><button class="table-button" data-qr-channel-save="${esc(item.channelId)}">保存</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无支付通道</td></tr>';
  const summary = state.qrMonitoring.summary || {}; setText('qrMonitorActive', summary.active ?? state.qrCodes.filter((x) => x.status === 'ACTIVE').length); setText('qrMonitorOrders', summary.orders24h ?? 0); setText('qrMonitorAmount', `¥${money(summary.amount24h || 0)}`); setText('qrMonitorAlerts', summary.alerts ?? 0);
  const monitorRows = document.querySelector('#qrMonitoringRows'); const monitored = state.qrMonitoring.data || []; if (monitorRows) monitorRows.innerHTML = monitored.length ? monitored.map((item) => `<tr><td><strong>${esc(item.name)}</strong><br><span class="subtle mono">${esc(item.qrCodeId)}</span></td><td class="mono">${esc(item.channelId || '未分配')}</td><td>${statusTag(item.status)}</td><td>${item.orderCount24h || 0} 笔<br><span class="subtle">¥${money(item.amount24h || 0)}</span></td><td>${item.orderCount24h ? `${Math.round(Number(item.successCount24h || 0) * 10000 / Number(item.orderCount24h)) / 100}%` : '-'}</td><td>${item.timeoutCount24h || 0}</td><td>${Number(item.alert) === 1 ? '<span class="danger-text">需要处理</span>' : '<span class="success-text">正常</span>'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无监控数据</td></tr>';
  const qrOrderRows = document.querySelector('#qrOrderRows'); if (qrOrderRows) qrOrderRows.innerHTML = state.qrOrders.length ? state.qrOrders.map((item) => `<tr><td class="mono">${esc(item.platformOrderNo)}</td><td>${esc(item.qrCodeName || item.qrCodeId)}</td><td>¥${money(item.amount)}</td><td>${statusTag(item.status)}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无挂码订单</td></tr>';
  const settlementRows = document.querySelector('#qrSettlementRows'); const settlement = state.qrSettlement?.data || []; if (settlementRows) settlementRows.innerHTML = settlement.length ? settlement.map((item) => `<tr><td><strong>${esc(item.qrCodeName || item.qrCodeId)}</strong><br><span class="subtle mono">${esc(item.qrCodeId || '')}</span></td><td class="mono">${esc(item.channelId || '-')}</td><td>${item.orderCount || 0}</td><td>${item.successCount || 0} / ${item.failedCount || 0}</td><td>${item.orderCount ? `${Math.round(Number(item.successCount || 0) * 10000 / Number(item.orderCount)) / 100}%` : '-'}</td><td>¥${money(item.grossAmount || 0)}</td><td>¥${money(item.refundAmount || 0)}</td><td><strong>¥${money(item.netAmount || 0)}</strong></td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">暂无挂码对账数据</td></tr>';
}
function renderPublicPaymentMonitoring() {
  const data = state.publicPaymentMonitoring || {}; const summary = data.summary || {};
  setText('ppmOrders', summary.jsapiOrders || 0); setText('ppmSuccessRate', `${summary.jsapiSuccessRate || 0}%`);
  setText('ppmArticleReady', summary.articleReady || 0); setText('ppmArticleFailed', summary.articleFailed || 0); setText('ppmPreviewReady', summary.previewReady || 0); setText('ppmWakeAttempted', summary.wakeAttempted || 0); setText('ppmWakeSwitched', summary.wakeAppSwitched || 0); setText('ppmHandoffTickets', summary.handoffTickets || 0); setText('ppmBridgeOpened', summary.bridgeOpened || 0); setText('ppmPreviewRedirected', summary.previewRedirected || 0); setText('ppmHandoffFailed', summary.handoffFailed || 0); setText('ppmWakeTimeout', summary.wakeWaitTimeout || 0); setText('ppmHandoffUnavailable', summary.handoffUnavailable || 0);
  setText('ppmFallback', summary.fallbackCount || 0); setText('ppmOauthCompleted', `${summary.oauthStarted || 0} / ${summary.oauthCompleted || 0}`);
  setText('ppmJsapiFailed', summary.jsapiFailed || 0); setText('ppmCallbacks', summary.jsapiCallbacks || 0); setText('ppmSuccessAmount', `¥${money(summary.jsapiSuccessAmount || 0)}`);
  setText('ppmWindow', `近 ${data.windowHours || 24} 小时`);
  const eventLabels = { ARTICLE_STARTED: '文章开始生成', ARTICLE_READY: '文章生成成功', ARTICLE_FAILED: '文章生成失败', PREVIEW_READY: '预览链接成功', PREVIEW_UNAVAILABLE: '预览链接不可用', HANDOFF_TICKET_CREATED: '中转 ticket 创建', HANDOFF_TICKET_FAILED: '中转 ticket 失败', WAKE_ATTEMPTED: '唤醒微信尝试', WAKE_APP_SWITCHED: '微信切到前台', WAKE_GATEWAY_FALLBACK: '旧版官方引导事件', WAKE_WAIT_TIMEOUT: '唤醒等待超时', WAKE_HANDOFF_UNAVAILABLE: '中转暂不可用', HANDOFF_BRIDGE_OPENED: '中转页打开', HANDOFF_PREVIEW_REDIRECTED: '中转页跳转预览', HANDOFF_BRIDGE_FAILED: '中转页失败', PREVIEW_NAVIGATION_ATTEMPTED: '预览页跳转尝试', COPY_LINK_USED: '复制预览链接', FALLBACK_JSAPI: '降级 JSAPI', OAUTH_STARTED: 'OAuth 开始', OAUTH_COMPLETED: 'OAuth 完成', OPENID_BOUND: 'OpenID 绑定', OPENID_BIND_REJECTED: 'OpenID 绑定拒绝', JSAPI_REQUESTED: 'JSAPI 请求', JSAPI_CREATED: 'JSAPI 下单成功', JSAPI_FAILED: 'JSAPI 下单失败' };
  const eventRows = document.querySelector('#ppmEventRows'); const events = data.events || [];
  if (eventRows) eventRows.innerHTML = events.length ? events.map((item) => `<tr><td>${esc(eventLabels[item.eventType] || item.eventType)}</td><td>${Number(item.count || 0)}</td><td>${item.avgDurationMs ? `${Number(item.avgDurationMs)} ms` : '-'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-cell">暂无公众号支付事件</td></tr>';
  const recentRows = document.querySelector('#ppmRecentRows'); const recent = data.recent || [];
  if (recentRows) recentRows.innerHTML = recent.length ? recent.map((item) => `<tr><td>${date(item.createdAt)}</td><td>${esc(eventLabels[item.eventType] || item.eventType)}</td><td class="mono">${esc(item.platformOrderNo || item.orderId || '-')}</td><td>${item.amount == null ? '-' : `¥${money(item.amount)}`}</td><td>${item.durationMs ? `${Number(item.durationMs)} ms` : '-'}</td><td class="danger-text">${esc(item.errorCode || '-')}</td><td>${statusTag(item.orderStatus || '-')}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无公众号支付事件</td></tr>';
}
function render() {
  const o = state.overview;
  setText('metricSubjects', o.subjects); setText('metricApps', o.apps); setText('metricMerchants', o.merchants);
  setText('metricChannels', o.activeChannels); setText('metricPending', o.pendingOrders); setText('metricSuccess', o.successOrders);
  renderDashboard();
  setText('monitorMode', state.health?.mockPayment ? '模拟支付' : 'APIv2 Native'); setText('monitorPending', o.pendingOrders);
  renderBot();
  setText('monitorRefunds', o.processingRefunds ?? 0); setText('monitorCallbacks', state.callbacks.length);
  setText('monitorRequests', state.metrics.requests ?? 0); setText('monitorErrors', Number(state.metrics.responses4xx || 0) + Number(state.metrics.responses5xx || 0));
  const readinessPanel = document.querySelector('#readinessPanel'); if (readinessPanel) { const r = state.readiness || {}; const channels = r.channels || {}; const issues = Array.isArray(r.issues) ? r.issues : []; const credentialText = r.mode === 'MOCK' ? '模拟模式无需凭证' : (r.credentials?.configured ? `已配置 ${r.credentials.count || 0} 个` : '未配置'); readinessPanel.className = `readiness-panel ${r.ready ? 'ready' : 'failed'}`; readinessPanel.innerHTML = `<div class="readiness-panel-head"><strong>生产接入检查</strong><span>${r.ready ? '已就绪' : '需处理'}</span></div><div class="readiness-meta"><span>运行模式：${r.mode === 'MOCK' ? '模拟支付' : '真实 APIv2 Native'}</span><span>支付凭证：${credentialText}</span><span>可用通道：${channels.ready || 0}/${channels.active || 0}</span></div>${issues.length ? `<p class="readiness-issues">配置问题：${issues.map((issue) => esc(issue)).join('、')}</p>` : '<p class="hint">环境、APIv2 密钥和至少一个可用通道均已通过检查。</p>'}`; }
  setText('callbackConfigMode', state.callbackConfig?.mode === 'MOCK' ? '模拟支付' : 'APIv2 Native'); setText('callbackConfigTransaction', state.callbackConfig?.transactionTemplate || '-'); setText('callbackConfigRefund', state.callbackConfig?.refundTemplate || '-');
  document.querySelector('#dashboardChannels').innerHTML = state.channels.slice(0, 8).map(channelRow).join('');
  document.querySelector('#dashboardOrders').innerHTML = state.orders.slice(0, 8).map((item) => `<tr><td class="mono">${esc(item.platformOrderNo)}</td><td>¥${money(item.amount)}</td><td>${statusTag(item.status)}</td></tr>`).join('');
  const visibleSubjects = filteredSubjects(); setText('subjectMetricTotal', state.subjects.length); setText('subjectMetricReady', state.subjects.filter((item) => subjectConfigurationState(item) === 'READY').length); setText('subjectMetricIncomplete', state.subjects.filter((item) => subjectConfigurationState(item) === 'NOT_READY').length); document.querySelector('#subjectRows').innerHTML = visibleSubjects.length ? visibleSubjects.map((item) => `<tr><td><strong>${esc(item.name)}</strong><br><span class="subtle mono">${esc(item.id)}</span></td><td>${labelOf(item.subjectType)}</td><td>${item.appCount}</td><td>${item.merchantCount}</td><td>${item.channelCount}</td><td>${statusTag(subjectConfigurationState(item))}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无匹配主体</td></tr>';
  const subjectFilter = document.querySelector('#appSubjectFilter'); const selectedAppSubject = subjectFilter?.value || ''; if (subjectFilter) { subjectFilter.innerHTML = '<option value="">全部主体</option>' + state.subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.id)}</option>`).join(''); if (selectedAppSubject) subjectFilter.value = selectedAppSubject; }
  const visibleApps = filteredApps(); setText('appMetricTotal', state.apps.length); setText('appMetricActive', state.apps.filter((item) => item.status === 'ACTIVE').length); setText('appMetricUnbound', state.apps.filter((item) => Number(item.bindingCount || 0) === 0).length); document.querySelector('#appRows').innerHTML = visibleApps.length ? visibleApps.map((item) => `<tr><td><strong class="mono">${esc(item.appid)}</strong><br><span class="subtle mono">${esc(item.id)}</span></td><td>${labelOf(item.appType)}</td><td>${esc(item.subjectName)}<br><span class="subtle mono">${esc(item.subjectId)}</span></td><td>${item.bindingCount || 0}</td><td>${statusTag(item.status)}<br><span class="subtle">公众号配置：${item.appSecretConfigured ? '已完成' : '待补充'}</span></td><td><button class="table-button" data-app-edit-id="${esc(item.id)}">配置</button> <button class="table-button" data-app-id="${esc(item.id)}" data-next-status="${item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}">${item.status === 'ACTIVE' ? '停用' : '启用'}</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">暂无匹配 AppID</td></tr>';
  const merchantSubjectFilter = document.querySelector('#merchantSubjectFilter'); const selectedMerchantSubject = merchantSubjectFilter?.value || ''; if (merchantSubjectFilter) { merchantSubjectFilter.innerHTML = '<option value="">全部主体</option>' + state.subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.id)}</option>`).join(''); if (selectedMerchantSubject) merchantSubjectFilter.value = selectedMerchantSubject; }
  const merchantTodayAmount = state.merchants.reduce((total, item) => total + Number(item.todaySuccessAmount || 0), 0); const merchantTodayOrders = state.merchants.reduce((total, item) => total + Number(item.todayOrderCount || 0), 0); const merchantTodaySuccess = state.merchants.reduce((total, item) => total + Number(item.todaySuccessOrderCount || 0), 0); const merchantAmount = state.merchants.reduce((total, item) => total + Number(item.successAmount || 0), 0); const merchantRefund = state.merchants.reduce((total, item) => total + Number(item.refundAmount || 0), 0); setText('merchantAccountMetricTotal', state.merchants.length); setText('merchantAccountMetricActive', state.merchants.filter((item) => item.status === 'ACTIVE').length); setText('merchantAccountMetricTodayAmount', `¥${money(merchantTodayAmount)}`); setText('merchantAccountMetricTodayRate', `${merchantTodayOrders ? Math.round(merchantTodaySuccess * 10000 / merchantTodayOrders) / 100 : 0}%`); setText('merchantAccountMetricAmount', `¥${money(merchantAmount)}`); setText('merchantAccountMetricRefund', `¥${money(merchantRefund)}`); setText('merchantAccountMetricIncomplete', state.merchants.filter((item) => Number(item.channelCount || 0) === 0 || Number(item.bindingCount || 0) === 0 || merchantCredentialState(item) === 'NOT_READY').length); const visibleMerchants = filteredMerchants(); document.querySelector('#merchantRows').innerHTML = visibleMerchants.length ? visibleMerchants.map(merchantAccountRow).join('') : '<tr><td colspan="11" class="empty-cell">暂无匹配商户号</td></tr>';
  renderClientMerchants();
  const visiblePlatformMerchants = filteredPlatformMerchants(); setText('merchantMetricTotal', state.platformMerchants.length); setText('merchantMetricActive', state.platformMerchants.filter((item) => item.status === 'ACTIVE').length); setText('merchantMetricRisk', state.platformMerchants.filter((item) => ['SUSPENDED', 'FROZEN'].includes(item.status)).length); setText('merchantMetricAlerts', state.platformMerchants.reduce((total, item) => total + Number(item.openAlertCount || 0), 0)); document.querySelector('#platformMerchantRows').innerHTML = visiblePlatformMerchants.length ? visiblePlatformMerchants.map(platformMerchantRow).join('') : '<tr><td colspan="6" class="empty-cell">暂无匹配的码商</td></tr>';
  const visibleChannels = filteredChannels(); setText('channelMetricTotal', state.channels.length); setText('channelMetricActive', state.channels.filter((item) => item.status === 'ACTIVE' && channelReadiness(item) === 'READY').length); setText('channelMetricAbnormal', state.channels.filter((item) => channelReadiness(item) === 'NOT_READY').length); setText('channelMetricOpen', state.channelHealth.filter((item) => item.circuitState === 'OPEN').length); document.querySelector('#channelRows').innerHTML = visibleChannels.length ? visibleChannels.map((item) => { const health = channelHealth(item); const monitor = state.monitoring.find((row) => String(row.channelId) === String(item.id)) || {}; const channelEnabled = item.status === 'ACTIVE'; return `<tr><td><button class="text-button" data-channel-detail-id="${esc(item.id)}">${esc(item.name || item.id)}</button><div class="subtle mono">编码：${esc(item.id)}</div><div class="subtle">产品：${channelProductLabel(item.paymentMethod)}</div></td><td><strong>${item.merchantCount ?? item.merchantIds?.length ?? 0}</strong> 个<br><span class="subtle">跨主体可用</span></td><td class="mono">${esc(item.mchId || '-')}<br><span class="subtle">${esc(item.appId || '-')}</span></td><td>${item.routeWeight}</td><td>${statusTag(channelReadiness(item))}<div class="subtle">${health.circuitState === 'OPEN' ? '熔断中' : health.consecutiveFailures ? `连续失败 ${health.consecutiveFailures}` : '运行正常'}</div></td><td>${monitor.successRate ?? 0}%</td><td><div class="channel-actions"><button type="button" class="status-switch channel-status-switch ${channelEnabled ? 'is-on' : ''}" role="switch" aria-checked="${channelEnabled}" aria-label="${esc(item.id)}通道开关" data-channel-id="${esc(item.id)}" data-next-status="${channelEnabled ? 'PAUSED' : 'ACTIVE'}">${channelEnabled ? '启用' : '停用'}<span></span></button><button class="table-button" data-edit-channel-id="${esc(item.id)}">编辑</button> <button class="table-button" data-channel-risk-id="${esc(item.id)}">风控配置</button> <button class="table-button" data-open-qr-channel="${esc(item.id)}">挂码配置</button>${health.circuitState === 'OPEN' ? ` <button class="table-button" data-reset-channel-health-id="${esc(item.id)}">恢复熔断</button>` : ''}</div></td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-cell">暂无匹配通道</td></tr>'; renderChannelDetail();
  setText('orderMetricTotal', state.ordersMeta.total ?? state.orders.length); setText('orderMetricSuccess', state.ordersMetrics.successCount ?? 0); setText('orderMetricAmount', `¥${money(state.ordersMetrics.successAmount ?? 0)}`); setText('orderMetricPending', state.ordersMetrics.pendingCount ?? 0); setText('orderMetricUnknown', state.ordersMetrics.unknownCount ?? 0); document.querySelector('#orderRows').innerHTML = state.orders.length ? state.orders.map(adminOrderRow).join('') : '<tr><td colspan="8" class="empty-cell">暂无订单</td></tr>'; renderPagination('orderPagination', state.ordersMeta); renderMemberBlocks();
  setText('exceptionMetricTotal', state.exceptionMetrics.totalCount ?? state.exceptionsMeta.total ?? state.exceptions.length); setText('exceptionMetricUnknown', state.exceptionMetrics.unknownCount ?? 0); setText('exceptionMetricFailed', state.exceptionMetrics.failedCount ?? 0); setText('exceptionMetricTimeout', state.exceptionMetrics.timeoutCount ?? 0); document.querySelector('#exceptionRows').innerHTML = state.exceptions.length ? state.exceptions.map(exceptionRow).join('') : '<tr><td colspan="8" class="empty-cell">当前没有待处理异常</td></tr>'; renderPagination('exceptionPagination', state.exceptionsMeta);
  document.querySelector('#refundRows').innerHTML = state.refunds.map((item) => `<tr><td class="mono">${esc(item.refundNo)}</td><td class="mono">${esc(item.platformOrderNo)}</td><td>¥${money(item.refundAmount)}</td><td>${esc(item.reason)}</td><td>${statusTag(item.status)}<br>${statusTag(item.approvalStatus || 'APPROVED')}</td><td>${item.approvalStatus === 'PENDING' ? `<button class="table-button" data-refund-approve="${esc(item.refundNo)}">审核通过</button> <button class="table-button" data-refund-reject="${esc(item.refundNo)}">驳回</button>` : '-'}</td><td>${date(item.createdAt)}</td></tr>`).join('');
  document.querySelector('#callbackRows').innerHTML = state.callbacks.length ? state.callbacks.map((item) => `<tr><td class="mono">${esc(item.notificationId || '-')}</td><td>${esc(item.channelId)}</td><td>${labelOf(item.eventType)}</td><td class="mono">${esc(item.outTradeNo || '-')}</td><td>${date(item.createdAt)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无回调记录</td></tr>';
  document.querySelector('#callbackTaskRows').innerHTML = state.callbackTasks.length ? state.callbackTasks.map((item) => `<tr><td class="mono">${esc(item.id)}</td><td>${esc(item.channelId)}</td><td>${statusTag(item.status)}</td><td>${item.attempts}</td><td>${esc(item.lastError || '-')}</td><td>${date(item.nextRetryAt)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">暂无重试任务</td></tr>';
  renderQrViews();
  renderPublicPaymentMonitoring();
  const routeChannelOptions = state.channels.map((item) => `<option value="${esc(item.id)}">${esc(item.id)} · ${item.merchantCount ?? item.merchantIds?.length ?? 0} 个商户</option>`).join('');
  const ruleChannelIds = document.querySelector('#ruleChannelIds');
  if (ruleChannelIds) ruleChannelIds.innerHTML = routeChannelOptions;
  const routingPreviewChannel = document.querySelector('#routingPreviewChannel');
  if (routingPreviewChannel) { const currentPreviewChannel = routingPreviewChannel.value; routingPreviewChannel.innerHTML = '<option value="">全部通道</option>' + routeChannelOptions; if (currentPreviewChannel) routingPreviewChannel.value = currentPreviewChannel; }
  refreshSubjectSelects();
  refreshMerchantAppPreview();
  refreshOrderFilters();
  const reconciliationChannel = document.querySelector('#reconciliationChannel');
  const selectedReconciliationChannel = reconciliationChannel.value;
  reconciliationChannel.innerHTML = '<option value="">全部通道</option>' + state.channels.map((item) => `<option value="${esc(item.id)}">${esc(item.id)} · ${item.merchantCount ?? item.merchantIds?.length ?? 0} 个商户</option>`).join('');
  reconciliationChannel.value = selectedReconciliationChannel;
  const statementMerchant = document.querySelector('#statementMerchantId');
  const selectedStatementMerchant = statementMerchant.value;
  statementMerchant.innerHTML = state.platformMerchants.filter((item) => item.status === 'ACTIVE').map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.code)}</option>`).join('');
  if (selectedStatementMerchant) statementMerchant.value = selectedStatementMerchant;
  document.querySelector('#routeRuleRows').innerHTML = state.rules.length ? state.rules.map((item) => `<tr><td><strong>${esc(item.name)}</strong><br><span class="subtle mono">${esc(item.id)} · v${Number(item.version || 1)}</span></td><td>${item.amountMin ?? '-'} ~ ${item.amountMax ?? '-'}</td><td>${esc((item.channelIds || []).join(', ') || '全部可用通道')}</td><td>${item.priority}</td><td>${statusTag(item.status)}</td><td><button class="table-button" data-rule-edit="${esc(item.id)}">编辑</button> <button class="table-button" data-rule-id="${esc(item.id)}" data-next-status="${item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}">${item.status === 'ACTIVE' ? '暂停' : '启用'}</button> <button class="table-button" data-rule-versions="${esc(item.id)}">版本</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">暂无路由规则，订单将按通道权重选择</td></tr>';
  document.querySelector('#monitorRows').innerHTML = state.monitoring.map((item) => `<tr><td class="mono">${esc(item.channelId)}</td><td>${esc(item.subjectName)}</td><td>${item.orderCount}</td><td>${item.successCount}</td><td>${item.exceptionCount}</td><td>${item.successRate}%</td><td>¥${money(item.orderAmount)}</td><td>${statusTag(item.circuitState)}</td><td>${item.consecutiveFailures ?? 0}</td><td>${item.circuitState === 'OPEN' ? `<button class="table-button" data-health-id="${esc(item.channelId)}">复位</button>` : '-'}</td></tr>`).join('');
  const consistency = state.consistency || { issueCount: 0, highCount: 0, checks: [] };
  const consistencySummary = document.querySelector('#consistencySummary');
  if (consistencySummary) consistencySummary.innerHTML = `<strong class="${Number(consistency.highCount) ? 'danger-text' : 'success-text'}">${Number(consistency.issueCount) ? `${consistency.issueCount} 项待处理` : '未发现异常'}</strong><span class="subtle">${date(consistency.checkedAt)}</span>`;
  const consistencyRows = document.querySelector('#consistencyRows');
  if (consistencyRows) consistencyRows.innerHTML = (consistency.checks || []).map((item) => `<div class="consistency-row"><span>${esc(item.label)}</span><span>${Number(item.count) ? `<strong class="${item.severity === 'HIGH' ? 'danger-text' : 'warning-text'}">${item.count} 条</strong><small class="subtle">${esc((item.sampleIds || []).slice(0, 3).join('、'))}</small>` : '<span class="success-text">正常</span>'}</span></div>`).join('');
  document.querySelector('#auditRows').innerHTML = state.audits.length ? state.audits.map((item) => `<tr><td>${date(item.createdAt)}</td><td>${esc(item.action)}</td><td>${esc(item.operator)}</td><td>${esc(item.targetType)} / ${esc(item.targetId || '-')}</td><td class="mono">${esc(item.detail)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无审计记录</td></tr>';
  document.querySelector('#adminRole').innerHTML = state.adminRoles.map((role) => `<option value="${esc(role)}">${labelOf(role)}</option>`).join('');
  const scopeLabels = { ALL: '全部数据', ASSIGNED_CLIENT_MERCHANTS: '指定接入商户', ASSIGNED_CODE_MERCHANTS: '指定码商', ASSIGNED_CHANNELS: '指定通道' };
  document.querySelector('#adminUserRows').innerHTML = state.adminUsers.length ? state.adminUsers.map((item) => `<tr><td class="mono">${esc(item.username)}</td><td>${labelOf(item.role)}</td><td>${esc(scopeLabels[item.dataScope] || item.dataScope || '全部数据')}<br><span class="subtle mono">${esc((item.dataScopeIds || []).join(', ') || '全部')}</span></td><td>${statusTag(item.status)}</td><td><button class="table-button" data-admin-id="${esc(item.id)}" data-next-status="${item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}">${item.status === 'ACTIVE' ? '停用' : '启用'}</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">当前认证未开启或暂无管理员</td></tr>';
  renderReconciliation();
  renderRefundSelect();
  renderPlatformMerchantDetail();
}

function renderReconciliation() {
  const latest = state.reconciliation.detail;
  if (latest) {
    const s = latest.summary || {};
    document.querySelector('#reconciliationSummary').innerHTML = [
      ['订单数', s.orderCount], ['订单金额', `¥${money(s.orderAmount)}`], ['支付成功', s.successCount],
      ['待查订单', s.pendingCount], ['关闭/失败', Number(s.closedCount || 0) + Number(s.failedCount || 0)], ['退款金额', `¥${money(s.refundAmount)}`],
      ['外部已匹配', s.matchedCount ?? 0], ['外部独有', s.externalOnlyCount ?? 0], ['本地独有', s.localOnlyCount ?? 0], ['金额差异', s.amountMismatchCount ?? 0], ['状态差异', s.statusMismatchCount ?? 0], ['退款差异', s.refundMismatchCount ?? 0], ['净结算', `¥${money(s.netSettlementAmount)}`]
    ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
    document.querySelector('#reconciliationItemRows').innerHTML = (latest.items || []).length ? latest.items.map((item) => `<tr><td class="mono">${esc(item.platformOrderNo)}</td><td>${esc(item.channelId)}</td><td>¥${money(item.amount)}</td><td>${statusTag(item.status)}</td><td>${reconStatusTag(item.reconciliationStatus)}</td><td>¥${money(item.refundedAmount)}</td><td>${date(item.createdAt)}</td><td>${item.reconciliationItemId && item.reconciliationStatus !== 'MATCHED' ? `<button class="table-button" data-recon-resolve="${esc(item.reconciliationItemId)}" data-recon-resolution="RESOLVED">已处理</button> <button class="table-button" data-recon-resolve="${esc(item.reconciliationItemId)}" data-recon-resolution="IGNORED">忽略</button>` : '-'}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">本批次没有订单</td></tr>';
  } else {
    document.querySelector('#reconciliationSummary').innerHTML = '<div class="empty-cell">尚未生成对账批次</div>';
    document.querySelector('#reconciliationItemRows').innerHTML = '<tr><td colspan="7" class="empty-cell">尚未生成对账批次</td></tr>';
  }
  document.querySelector('#reconciliationRows').innerHTML = state.reconciliation.runs.length ? state.reconciliation.runs.map((run) => {
    const s = run.summary || {};
    return `<tr><td class="mono"><button class="text-button" data-recon-id="${esc(run.id)}">${esc(run.id)}</button></td><td>${dateOnly(run.dateFrom)} ~ ${dateOnly(run.dateTo)}</td><td>${esc(run.channelId || '全部通道')}</td><td>${s.orderCount ?? 0}</td><td>¥${money(s.orderAmount)}</td><td>${s.successCount ?? 0} / ${s.pendingCount ?? 0} / ${Number(s.failedCount || 0) + Number(s.closedCount || 0)}</td><td>¥${money(s.refundAmount)}</td><td>${date(run.createdAt)}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty-cell">暂无对账批次</td></tr>';
  document.querySelector('#settlementRows').innerHTML = state.reconciliation.settlement.length ? state.reconciliation.settlement.map((item) => `<tr><td class="mono">${esc(item.channelId)}</td><td>${esc(item.subjectName)}</td><td class="mono">${esc(item.mchId)}</td><td>${item.orderCount}</td><td>¥${money(item.grossAmount)}</td><td>¥${money(item.refundAmount)}</td><td>¥${money(item.feeAmount)}</td><td>¥${money(item.netAmount)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">当前日期范围没有成功订单</td></tr>';
  document.querySelector('#statementRows').innerHTML = state.settlementStatements.length ? state.settlementStatements.map((item) => `<tr><td class="mono">${esc(item.id)}</td><td>${esc(item.merchantName)}</td><td>${dateOnly(item.dateFrom)} ~ ${dateOnly(item.dateTo)}</td><td>¥${money(item.netAmount)}</td><td>${statusTag(item.status)}</td><td>${date(item.createdAt)}</td><td><button class="table-button" data-settlement-difference="${esc(item.id)}">核对</button> ${item.status === 'DRAFT' ? `<button class="table-button" data-settlement-id="${esc(item.id)}" data-next-settlement-status="CONFIRMED">确认</button>` : item.status === 'CONFIRMED' ? `<button class="table-button" data-settlement-id="${esc(item.id)}" data-next-settlement-status="PAID">标记已打款</button>` : item.status === 'PAID' ? '-' : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无结算单</td></tr>';
}

function channelProductLabel(value) { return String(value || 'NATIVE') === 'JSAPI' ? '公众号支付' : 'Native 扫码'; }

function channelRow(item, withAction = false) {
  const enabled = item.status === 'ACTIVE';
  return `<tr><td><strong>${esc(item.name || item.id)}</strong><br><span class="subtle mono">编码：${esc(item.id)}</span><br><span class="subtle">产品：${channelProductLabel(item.paymentMethod)}</span></td><td>${item.merchantCount ?? item.merchantIds?.length ?? 0} 个</td><td class="mono">${esc(item.mchId || '-')}<br><span class="subtle">${esc(item.appId || '-')}</span></td><td>${item.routeWeight}</td><td>${statusTag(item.status)}</td>${withAction ? `<td><button type="button" class="status-switch channel-status-switch ${enabled ? 'is-on' : ''}" role="switch" aria-checked="${enabled}" aria-label="${esc(item.id)}通道开关" data-channel-id="${esc(item.id)}" data-next-status="${enabled ? 'PAUSED' : 'ACTIVE'}">${enabled ? '启用' : '停用'}<span></span></button></td>` : ''}</tr>`;
}

function channelHealth(item) { return state.channelHealth.find((health) => String(health.channelId) === String(item.id)) || {}; }
function channelPreflight(item) { return state.channelPreflights[item.id] || {}; }
function channelReadiness(item) { const preflight = channelPreflight(item); const health = channelHealth(item); if (health.circuitState === 'OPEN') return 'OPEN'; return preflight.ready === true ? 'READY' : 'NOT_READY'; }
function filteredChannels() {
  const search = (document.querySelector('#channelSearch')?.value || '').trim().toLowerCase();
  const status = document.querySelector('#channelStatusFilter')?.value || '';
  const health = document.querySelector('#channelHealthFilter')?.value || '';
  return state.channels.filter((item) => {
    const matchesSearch = !search || [item.id, item.name, item.subjectName, item.appId, item.mchId, item.credentialRef, ...(item.merchantIds || [])].some((value) => String(value || '').toLowerCase().includes(search));
    return matchesSearch && (!status || item.status === status) && (!health || channelReadiness(item) === health);
  });
}
function filteredSubjects() {
  const query = (document.querySelector('#subjectSearch')?.value || '').trim().toLowerCase();
  const type = document.querySelector('#subjectTypeFilter')?.value || '';
  return state.subjects.filter((item) => (!query || [item.id, item.name].some((value) => String(value || '').toLowerCase().includes(query))) && (!type || item.subjectType === type));
}
function subjectConfigurationState(item) {
  return Number(item.appCount || 0) > 0 && Number(item.merchantCount || 0) > 0 && Number(item.channelCount || 0) > 0 ? 'READY' : 'NOT_READY';
}
function filteredApps() {
  const query = (document.querySelector('#appSearch')?.value || '').trim().toLowerCase();
  const subjectId = document.querySelector('#appSubjectFilter')?.value || '';
  const status = document.querySelector('#appStatusFilter')?.value || '';
  return state.apps.filter((item) => (!query || [item.id, item.appid, item.subjectName].some((value) => String(value || '').toLowerCase().includes(query))) && (!subjectId || item.subjectId === subjectId) && (!status || item.status === status));
}
function filteredMerchants() {
  const query = (document.querySelector('#merchantSearch')?.value || '').trim().toLowerCase();
  const subjectId = document.querySelector('#merchantSubjectFilter')?.value || '';
  const status = document.querySelector('#merchantStatusFilter')?.value || '';
  return state.merchants.filter((item) => (!query || [item.id, item.mchid, item.subjectName, item.appId].some((value) => String(value || '').toLowerCase().includes(query))) && (!subjectId || item.subjectId === subjectId) && (!status || item.status === status));
}
function refreshSubjectSelects() {
  const subjects = Array.isArray(state.subjects) ? state.subjects : [];
  const subjectOptions = subjects.length
    ? '<option value="">请选择所属主体</option>' + subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.id)}</option>`).join('')
    : '<option value="">暂无可用主体，请先新增主体</option>';
  ['appSubjectId'].forEach((id) => {
    const node = document.querySelector(`#${id}`);
    if (!node) return;
    const current = node.value;
    node.innerHTML = subjectOptions;
    if (current && [...node.options].some((option) => option.value === current)) node.value = current;
  });
}

function updateMerchantDerivedSubject() {
  const node = document.querySelector('#merchantDerivedSubject');
  if (!node) return true;
  const nativeEnabled = document.querySelector('#merchantPaymentNative')?.checked;
  const jsapiEnabled = document.querySelector('#merchantPaymentJsapi')?.checked;
  const ids = [nativeEnabled ? document.querySelector('#merchantNativeAppId')?.value : '', jsapiEnabled ? document.querySelector('#merchantJsapiAppId')?.value : ''].filter(Boolean);
  const apps = ids.map((id) => state.apps.find((item) => String(item.id) === String(id))).filter(Boolean);
  const subjects = [...new Map(apps.map((item) => [String(item.subjectId), item])).values()];
  node.className = subjects.length > 1 ? 'merchant-derived-subject error' : 'merchant-derived-subject';
  node.textContent = !subjects.length ? '选择 AppID 后自动带出' : subjects.length > 1 ? '所选 AppID 属于不同主体，请重新选择' : `${subjects[0].subjectName || subjects[0].subjectId} · ${subjects[0].subjectId}`;
  return subjects.length <= 1;
}

function normalizeMerchantPaymentSelector() {
  const inputs = Array.from(document.querySelectorAll('#merchantForm input[name="paymentMethods"]'));
  inputs.forEach((input) => { input.type = 'radio'; input.setAttribute('aria-label', input.value === 'JSAPI' ? '公众号支付' : 'Native 扫码'); });
  const hint = document.querySelector('#merchantForm fieldset.form-fieldset .hint');
  if (hint) hint.textContent = '每个商户号只能选择一种支付方式。';
  const subjectHint = document.querySelector('#merchantForm .merchant-app-subject-hint small');
  if (subjectHint) subjectHint.textContent = '主体已绑定在 AppID 上，无需重复选择。';
}

function refreshMerchantAppPreview(currentNative = '', currentJsapi = '') {
  const nativeSelect = document.querySelector('#merchantNativeAppId'); const jsapiSelect = document.querySelector('#merchantJsapiAppId'); if (!nativeSelect || !jsapiSelect) return;
  const previousNative = currentNative || nativeSelect.value;
  const previousJsapi = currentJsapi || jsapiSelect.value;
  const apps = state.apps.filter((item) => item.status === 'ACTIVE');
  nativeSelect.innerHTML = apps.length ? apps.map((item) => `<option value="${esc(item.id)}">${esc(item.appid)} · ${esc(item.subjectName || item.subjectId)}</option>`).join('') : '<option value="">暂无可用 AppID</option>';
  const jsapiApps = apps.filter((item) => item.appType === 'SERVICE_ACCOUNT' && item.appSecretConfigured);
  jsapiSelect.innerHTML = jsapiApps.length ? jsapiApps.map((item) => `<option value="${esc(item.id)}">${esc(item.appid)} · ${esc(item.subjectName || item.subjectId)} · 公众号配置已完成</option>`).join('') : '<option value="">暂无已配置公众号 AppID</option>';
  if ([...nativeSelect.options].some((option) => option.value === previousNative)) nativeSelect.value = previousNative;
  if ([...jsapiSelect.options].some((option) => option.value === previousJsapi)) jsapiSelect.value = previousJsapi;
  updateMerchantDerivedSubject();
}

function syncMerchantPaymentFields() {
  const native = document.querySelector('#merchantPaymentNative')?.checked;
  const jsapi = document.querySelector('#merchantPaymentJsapi')?.checked;
  document.querySelector('#merchantNativeAppField')?.classList.toggle('hidden', !native);
  document.querySelector('#merchantJsapiAppField')?.classList.toggle('hidden', !jsapi);
  const nativeSelect = document.querySelector('#merchantNativeAppId'); const jsapiSelect = document.querySelector('#merchantJsapiAppId');
  if (nativeSelect) { nativeSelect.required = Boolean(native); nativeSelect.disabled = !native; }
  if (jsapiSelect) { jsapiSelect.required = Boolean(jsapi); jsapiSelect.disabled = !jsapi; }
}

function openChannelModal(item) {
  const form = document.querySelector('#channelForm'); form.reset();
  const editing = Boolean(item); form.elements.editId.value = item?.id || ''; form.elements.id.value = item?.id || '';
  form.elements.name.value = item?.name || item?.id || '';
  form.elements.paymentMethod.value = item?.paymentMethod || 'NATIVE';
  form.elements.routeWeight.value = item?.routeWeight ?? 100;
  form.elements.id.readOnly = editing; document.querySelector('#channelModalTitle').textContent = editing ? '编辑支付通道' : '新增支付通道';
  document.querySelector('#channelFormMessage').textContent = ''; document.querySelector('#channelFormMessage').className = 'message';
  document.querySelector('#channelModal').classList.remove('hidden'); setTimeout(() => (editing ? form.elements.routeWeight : form.elements.id).focus(), 0);
}
function closeChannelModal() { document.querySelector('#channelModal')?.classList.add('hidden'); }
function closeChannelRiskModal() { document.querySelector('#channelRiskModal')?.classList.add('hidden'); }
async function openChannelRiskModal(channelId) {
  const channel = state.channels.find((item) => String(item.id) === String(channelId));
  const modal = document.querySelector('#channelRiskModal'); const form = document.querySelector('#channelRiskForm');
  if (!channel || !modal || !form) return;
  form.reset(); form.elements.channelId.value = channel.id;
  document.querySelector('#channelRiskModalTitle').textContent = `风控配置 · ${channel.id}`;
  document.querySelector('#channelRiskModalHint').textContent = `路由组 · 已绑定 ${channel.merchantCount ?? channel.merchantIds?.length ?? 0} 个商户号 · 主商户 ${channel.mchId || '-'}`;
  setMessage('channelRiskMessage', '正在读取当前配置…', false); modal.classList.remove('hidden');
  try {
    const policy = (await api(`/api/v1/admin/channels/${encodeURIComponent(channel.id)}/risk`)).data || {};
    ['singleIpPaymentLimit', 'consecutiveFailureLimit', 'userIdPaymentLimit', 'dailyOrderLimit', 'floatingAmountMin', 'floatingAmountMax', 'amountMin', 'amountMax', 'dailyAmountLimit', 'regionBlacklist'].forEach((key) => { if (form.elements[key]) form.elements[key].value = policy[key] ?? (key === 'regionBlacklist' ? '' : 0); });
    setMessage('channelRiskMessage', '可按通道实际承载能力设置限制，0 表示不限制。', false);
  } catch (error) { setMessage('channelRiskMessage', error.message || String(error), true); }
}

function openSubjectModal() {
  const form = document.querySelector('#subjectForm'); form.reset();
  document.querySelector('#subjectFormMessage').textContent = ''; document.querySelector('#subjectFormMessage').className = 'message';
  document.querySelector('#subjectModal')?.classList.remove('hidden');
  setTimeout(() => form.elements.name.focus(), 0);
}
function closeSubjectModal() { document.querySelector('#subjectModal')?.classList.add('hidden'); }
function openAppModal(item) {
  const form = document.querySelector('#appForm'); form.reset(); refreshSubjectSelects(); form.dataset.editingId = item?.id || '';
  form.elements.subjectId.disabled = Boolean(item); form.elements.appid.readOnly = Boolean(item); form.elements.appType.disabled = Boolean(item);
  if (item) { form.elements.subjectId.value = item.subjectId || ''; form.elements.appid.value = item.appid || ''; form.elements.appType.value = item.appType || 'SERVICE_ACCOUNT'; form.elements.oauthDomain.value = item.oauthDomain || ''; form.elements.jsapiPath.value = item.jsapiPath || ''; form.elements.verifyFile.value = item.verifyFile || ''; }
  document.querySelector('#appFormMessage').textContent = ''; document.querySelector('#appFormMessage').className = 'message';
  document.querySelector('#appModal')?.classList.remove('hidden');
  setTimeout(() => form.elements.subjectId.focus(), 0);
}
function closeAppModal() { document.querySelector('#appModal')?.classList.add('hidden'); }
function openMerchantModal(item) {
  const form = document.querySelector('#merchantForm'); form.reset(); form.dataset.editingId = item?.id || '';
  if (item) {
    form.elements.mchid.value = item.mchid || '';
    form.elements.dailyAmountLimit.value = Number(item.dailyAmountLimit || 0);
    const methods = item.paymentMethods || [];
    const selectedMethod = methods.some((method) => method.method === 'NATIVE') ? 'NATIVE' : 'JSAPI';
    form.querySelectorAll('input[name="paymentMethods"]').forEach((input) => { input.checked = input.value === selectedMethod; });
    form.elements.mchid.readOnly = true;
    form.elements.apiV2Key.required = false;
  } else {
    form.elements.mchid.readOnly = false;
    form.elements.apiV2Key.required = true;
    form.querySelector('#merchantPaymentNative').checked = true; form.querySelector('#merchantPaymentJsapi').checked = false;
  }
  const nativeMethod = (item?.paymentMethods || []).find((method) => method.method === 'NATIVE');
  const jsapiMethod = (item?.paymentMethods || []).find((method) => method.method === 'JSAPI');
  refreshMerchantAppPreview(nativeMethod?.appId || item?.appId || '', jsapiMethod?.appId || '');
  syncMerchantPaymentFields();
  document.querySelector('#merchantModalTitle').textContent = item ? '编辑商户号' : '新增商户号';
  document.querySelector('#merchantFormMessage').textContent = ''; document.querySelector('#merchantFormMessage').className = 'message';
  document.querySelector('#merchantModal')?.classList.remove('hidden');
  setTimeout(() => (item ? form.elements.mchid : form.elements.nativeAppId).focus(), 0);
}
function closeMerchantModal() { document.querySelector('#merchantModal')?.classList.add('hidden'); }
function closeMerchantPaymentTestModal() {
  merchantPaymentTestTarget = null;
  merchantPaymentTestOrderNo = '';
  document.querySelector('#merchantPaymentTestModal')?.classList.add('hidden');
}
function openMerchantPaymentTestModal(merchant) {
  if (!merchant) return;
  const methods = Array.isArray(merchant.paymentMethods) ? merchant.paymentMethods : [];
  const nativeEnabled = methods.some((method) => method.method === 'NATIVE' && String(method.status || 'ACTIVE') === 'ACTIVE');
  const jsapiEnabled = methods.some((method) => method.method === 'JSAPI' && String(method.status || 'ACTIVE') === 'ACTIVE');
  const paymentMethod = !nativeEnabled && jsapiEnabled ? 'JSAPI' : 'NATIVE';
  merchantPaymentTestTarget = merchant;
  merchantPaymentTestTarget.testPaymentMethod = paymentMethod;
  const form = document.querySelector('#merchantPaymentTestForm');
  if (!form) return;
  form.reset();
  form.elements.amountYuan.value = '1.00';
  form.elements.description.value = paymentMethod === 'JSAPI' ? '公众号支付测试' : 'Native 支付测试';
  setText('merchantPaymentTestTitle', paymentMethod === 'JSAPI' ? '公众号支付测试' : 'Native 扫码支付测试');
  setText('merchantPaymentTestHint', `${merchant.mchid} · ${merchant.subjectName} · ${paymentMethod === 'JSAPI' ? '公众号 JSAPI 支付' : 'Native 扫码支付'}`);
  setText('merchantPaymentTestAmountHint', paymentMethod === 'JSAPI' ? '将创建订单专属公众号支付链接和二维码' : '将创建微信 Native 扫码测试二维码');
  setMessage('merchantPaymentTestMessage', '请输入金额后生成测试二维码。测试订单仍会写入订单管理，可扫码后查看支付结果。', false);
  const result = document.querySelector('#merchantPaymentTestResult');
  merchantPaymentTestOrderNo = '';
  result?.classList.add('hidden');
  if (result) result.innerHTML = '';
  document.querySelector('#merchantPaymentTestModal')?.classList.remove('hidden');
  setTimeout(() => form.elements.amountYuan.focus(), 0);
}
async function createMerchantPaymentTest() {
  const form = document.querySelector('#merchantPaymentTestForm');
  const merchant = merchantPaymentTestTarget;
  if (!form || !merchant) return;
  const amountYuan = Number(form.elements.amountYuan.value);
  const amount = Math.round(amountYuan * 100);
  if (!Number.isFinite(amountYuan) || !Number.isInteger(amount) || amount <= 0) { setMessage('merchantPaymentTestMessage', '请输入大于 0 的金额，最多保留两位小数。', true); return; }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const paymentMethod = merchant.testPaymentMethod === 'JSAPI' ? 'JSAPI' : 'NATIVE';
  setMessage('merchantPaymentTestMessage', paymentMethod === 'JSAPI' ? '正在创建公众号支付订单并准备支付链接…' : '正在创建 Native 测试订单并生成二维码…', false);
  try {
    const defaultDescription = paymentMethod === 'JSAPI' ? '公众号支付测试' : 'Native 支付测试';
    const result = await api(`/api/v1/admin/merchants/${encodeURIComponent(merchant.id)}/payment-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, description: String(form.elements.description.value || defaultDescription).trim() || defaultDescription }) });
    const order = result.data || {};
    const panel = document.querySelector('#merchantPaymentTestResult');
    if (panel) {
      if (paymentMethod === 'JSAPI') {
        const payUrl = result.entry?.payUrl || '';
        panel.innerHTML = `<img src="${esc(result.entry?.qrDataUrl || '')}" alt="公众号支付链接二维码"><div class="test-order-meta"><strong>请在手机浏览器打开支付链接</strong><span>订单号：<code>${esc(order.platformOrderNo)}</code></span><span>金额：¥${money(order.amount)}</span><span>通道：${esc(result.channel?.id || order.channelId || '-')} · ${esc(result.channel?.mchId || '')}</span><span data-test-order-status>状态：${esc(labelOf(order.status || 'QR_CREATED'))}</span><a class="test-payment-link" href="${esc(payUrl)}" target="_blank" rel="noopener">打开订单支付链接</a><small>链接有效期约 15 分钟；订单支付后会自动回调更新状态。</small><button type="button" class="ghost-button" data-copy-merchant-payment-url="${esc(payUrl)}">复制支付链接</button><button type="button" class="ghost-button" data-refresh-merchant-payment-test>刷新支付状态</button></div>`;
      } else {
        panel.innerHTML = `<img src="${esc(order.qrDataUrl || '')}" alt="Native 支付测试二维码"><div class="test-order-meta"><strong>请使用微信扫码支付</strong><span>订单号：<code>${esc(order.platformOrderNo)}</code></span><span>金额：¥${money(order.amount)}</span><span>通道：${esc(result.channel?.id || order.channelId || '-')} · ${esc(result.channel?.mchId || '')}</span><span data-test-order-status>状态：${esc(labelOf(order.status || 'QR_CREATED'))}</span><small>二维码有效期约 15 分钟。二维码支付完成后会自动回调更新状态。</small><button type="button" class="ghost-button" data-refresh-merchant-payment-test>刷新支付状态</button></div>`;
      }
      panel.classList.remove('hidden');
      merchantPaymentTestOrderNo = String(order.platformOrderNo || '');
    }
    setMessage('merchantPaymentTestMessage', result.provider === 'mock' ? '支付入口已生成。当前是模拟支付模式，只能验证订单和页面流程；真实支付需要切换生产模式并配置真实凭证。' : paymentMethod === 'JSAPI' ? '公众号支付订单已生成，请打开订单专属链接测试。' : '二维码已生成，当前使用 Native 支付流程。', false);
  } catch (error) { showError(error, 'merchantPaymentTestMessage'); }
  finally { submit.disabled = false; }
}
async function refreshMerchantPaymentTestStatus() {
  if (!merchantPaymentTestOrderNo) return;
  const button = document.querySelector('[data-refresh-merchant-payment-test]');
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/v1/admin/orders/${encodeURIComponent(merchantPaymentTestOrderNo)}/detail`);
    const detail = result.data || {};
    const order = detail.order || detail;
    const status = document.querySelector('[data-test-order-status]');
    if (status) status.textContent = `状态：${labelOf(order.status || 'UNKNOWN')}`;
    setMessage('merchantPaymentTestMessage', `订单当前状态：${labelOf(order.status || 'UNKNOWN')}`, false);
  } catch (error) { showError(error, 'merchantPaymentTestMessage'); }
  finally { if (button) button.disabled = false; }
}
function openMerchantCloneModal(item) {
  const modal = document.querySelector('#merchantCloneModal'); const form = document.querySelector('#merchantCloneForm');
  if (!modal || !form || !item) return;
  form.reset(); form.elements.sourceId.value = item.id; form.elements.dailyAmountLimit.value = Number(item.dailyAmountLimit || 0);
  const apps = state.apps.filter((entry) => String(entry.subjectId) === String(item.subjectId) && entry.status === 'ACTIVE');
  form.elements.appId.innerHTML = apps.length ? apps.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.appid)}</option>`).join('') : '<option value="">该主体暂无可用 AppID</option>';
  document.querySelector('#merchantCloneModalHint').textContent = `来源：${item.mchid} · ${item.subjectName} · 新商户默认停用`;
  setMessage('merchantCloneMessage', '', false); modal.classList.remove('hidden');
  setTimeout(() => form.elements.mchid.focus(), 0);
}
function closeMerchantCloneModal() { document.querySelector('#merchantCloneModal')?.classList.add('hidden'); }
function closeMerchantBatchRiskModal() {
  merchantBatchRiskTargets = [];
  merchantBatchRiskSingle = false;
  document.querySelector('#merchantBatchRiskModal')?.classList.add('hidden');
}
function openMerchantBatchRiskModal(ids, options = {}) {
  const targets = ids.map((id) => state.merchants.find((item) => String(item.id) === String(id))).filter(Boolean);
  if (!targets.length) return;
  merchantBatchRiskTargets = targets.map((item) => String(item.id));
  merchantBatchRiskSingle = Boolean(options.single);
  const form = document.querySelector('#merchantBatchRiskForm');
  if (!form) return;
  form.reset();
  const first = targets[0];
  const commonValue = (key) => targets.every((item) => Number(item[key] || 0) === Number(first[key] || 0)) ? Number(first[key] || 0) : 0;
  form.elements.orderWindowSeconds.value = commonValue('orderWindowSeconds');
  form.elements.orderWindowLimit.value = commonValue('orderWindowLimit');
  form.elements.dailyOrderLimit.value = commonValue('dailyOrderLimit');
  form.elements.dailySuccessLimit.value = commonValue('dailySuccessLimit');
  form.elements.riskEnabled.value = targets.every((item) => Number(item.riskEnabled ?? 1) === Number(first.riskEnabled ?? 1)) ? String(Number(first.riskEnabled ?? 1) ? 1 : 0) : '1';
  setText('merchantBatchRiskModalTitle', options.single ? '进单风控设置' : `批量进单风控 · ${targets.length} 个商户号`);
  setText('merchantBatchRiskModalHint', options.single ? `商户号：${first.mchid} · ${first.subjectName}` : '保存后将统一覆盖所选商户号的进单规则。');
  setText('merchantBatchRiskNoticeTitle', options.single ? '商户号风控规则' : '统一设置规则');
  setText('merchantBatchRiskNoticeText', options.single ? '以下配置会覆盖该商户号的进单风控；填 0 表示不限制。时间窗口按商户号累计统计，成功上限只统计支付成功订单。' : '以下配置会覆盖选中商户号的进单风控；填 0 表示不限制。时间窗口按商户号累计统计，成功上限只统计支付成功订单。');
  setMessage('merchantBatchRiskMessage', '', false);
  document.querySelector('#merchantBatchRiskModal')?.classList.remove('hidden');
  setTimeout(() => form.elements.orderWindowSeconds.focus(), 0);
}
function closeMerchantChannelModal() {
  merchantChannelBindingTarget = null;
  merchantChannelBindingTargets = [];
  document.querySelector('#merchantChannelModal')?.classList.add('hidden');
}
async function openMerchantChannelModal(merchantId) {
  const ids = (Array.isArray(merchantId) ? merchantId : [merchantId]).map((id) => String(id));
  const merchants = ids.map((id) => state.merchants.find((item) => String(item.id) === id)).filter(Boolean);
  if (!merchants.length) return;
  const subjectIds = new Set(merchants.map((item) => String(item.subjectId)));
  if (subjectIds.size > 1) { setMessage('merchantMessage', '批量绑定通道需要选择同一主体下的商户号', true); return; }
  merchantChannelBindingTarget = ids.length === 1 ? ids[0] : null;
  merchantChannelBindingTargets = ids.length > 1 ? ids : [];
  setText('merchantChannelModalTitle', ids.length > 1 ? `批量绑定通道 · ${ids.length} 个商户号` : `绑定通道 · ${merchants[0].mchid}`);
  setText('merchantChannelModalHint', `通道是独立的轮询路由组，可跨主体复用；${ids.length > 1 ? '选中的通道将应用到全部商户号。' : '一个通道可以绑定多个商户号。'}`);
  setMessage('merchantChannelMessage', '正在读取通道…', false);
  document.querySelector('#merchantChannelOptions').innerHTML = '<p class="hint">正在加载…</p>';
  document.querySelector('#merchantChannelModal')?.classList.remove('hidden');
  try {
    const channels = (await api(`/api/v1/admin/merchants/${encodeURIComponent(merchants[0].id)}/channels`)).data || [];
    document.querySelector('#merchantChannelOptions').innerHTML = channels.length ? channels.map((channel) => `<label class="channel-option"><input type="checkbox" value="${esc(channel.id)}" ${channel.bound ? 'checked' : ''}><span class="channel-option-body"><span class="channel-option-title">${esc(channel.id)} · ${esc(channel.status)}</span><span class="channel-option-meta">路由组 · 已绑定 ${channel.merchantCount || 0} 个商户号 · 权重 ${channel.routeWeight} · 主商户 ${esc(channel.mchid || '-')}</span></span></label>`).join('') : '<p class="hint">暂无可用支付通道，请先在支付通道页面创建路由组。</p>';
    setMessage('merchantChannelMessage', `已绑定 ${channels.filter((channel) => channel.bound).length} 个通道`, false);
  } catch (error) { showError(error, 'merchantChannelMessage'); }
}

function closeChannelMerchantAuthModal() {
  channelMerchantAuthTarget = null;
  document.querySelector('#channelMerchantAuthModal')?.classList.add('hidden');
}

async function openChannelMerchantAuthModal(channelId) {
  const channel = state.channels.find((item) => String(item.id) === String(channelId));
  if (!channel) return;
  channelMerchantAuthTarget = String(channelId);
  const options = document.querySelector('#channelMerchantAuthOptions');
  setText('channelMerchantAuthTitle', `配置码商授权 · ${channel.id}`);
  setText('channelMerchantAuthHint', '仅授权正常码商使用该支付通道；未授权的码商不会命中该通道。');
  options.innerHTML = '<p class="hint">正在加载码商授权…</p>';
  setMessage('channelMerchantAuthMessage', '正在读取当前授权…', false);
  document.querySelector('#channelMerchantAuthModal')?.classList.remove('hidden');
  try {
    const current = (state.channelDetail?.channel?.id === String(channelId) ? state.channelDetail.platformMerchants : (await api(`/api/v1/admin/channels/${encodeURIComponent(channelId)}/detail`)).data.platformMerchants) || [];
    const selected = new Set(current.map((item) => String(item.id)));
    const merchants = state.platformMerchants.filter((item) => item.status === 'ACTIVE');
    options.innerHTML = merchants.length ? merchants.map((merchant) => `<label class="channel-option"><input type="checkbox" value="${esc(merchant.id)}" ${selected.has(String(merchant.id)) ? 'checked' : ''}><span class="channel-option-body"><span class="channel-option-title">${esc(merchant.name)} · ${esc(merchant.code)}</span><span class="channel-option-meta">状态：${esc(labelOf(merchant.status))} · 登录账号：${esc(merchant.loginUsername || '未设置')} · 支付开关：${merchant.status === 'ACTIVE' ? '可用' : '待启用'}</span></span></label>`).join('') : '<p class="hint">暂无可授权码商，请先创建并启用码商。</p>';
    setMessage('channelMerchantAuthMessage', `已授权 ${selected.size} 个码商`, false);
  } catch (error) {
    options.innerHTML = '<p class="hint">授权读取失败，请重试。</p>';
    showError(error, 'channelMerchantAuthMessage');
  }
}

function renderChannelDetail() {
  const container = document.querySelector('#channelDetail'); const panel = document.querySelector('#channelDetailBody'); const detail = state.channelDetail;
  if (!container || !panel) return; if (!detail) { container.classList.add('hidden'); panel.innerHTML = ''; return; }
  container.classList.remove('hidden'); const c = detail.channel; const h = detail.health || {}; const m = detail.monitoring || {}; const s = detail.stats || {};
  const readiness = h.circuitState === 'OPEN' ? 'OPEN' : detail.preflight?.ready ? 'READY' : 'NOT_READY';
  const boundMerchants = detail.boundMerchants || [];
  const platformMerchants = detail.platformMerchants || [];
  panel.innerHTML = `<div class="section-title"><div><div class="eyebrow">CHANNEL DETAIL</div><h2 id="channelDetailTitle">${esc(c.name || c.id)}</h2><p class="hint">编码：<span class="mono">${esc(c.id)}</span> · ${channelProductLabel(c.paymentMethod)} · 已绑定 ${c.merchantCount ?? 0} 个商户号 · 主商户 ${esc(c.mchId || '-')}</p></div><div class="inline-tools"><button class="ghost-button" data-channel-preflight="${esc(c.id)}">重新预检</button><button class="ghost-button" data-edit-channel-id="${esc(c.id)}">编辑</button><button class="ghost-button" data-close-channel-detail>关闭详情</button></div></div>
    <div class="channel-detail-stats"><article><span>累计订单</span><strong>${s.orderCount ?? 0}</strong></article><article><span>累计成功率</span><strong>${s.successRate ?? 0}%</strong></article><article><span>累计收款</span><strong>¥${money(s.successAmount ?? 0)}</strong></article><article><span>今日收款</span><strong>¥${money(s.todaySuccessAmount ?? 0)}</strong></article></div>
    <div class="channel-detail-grid"><div class="channel-detail-card"><h3>连接配置</h3><p>所属产品：${channelProductLabel(c.paymentMethod)}</p><p>凭证引用：<span class="mono">${esc(c.credentialRef || '-')}</span></p><p>回调路由：<span class="mono">${esc(c.notifyPath || '-')}/{mchid}</span><small class="subtle">系统根据通道编码自动生成</small></p><p>路由权重：${c.routeWeight}</p><p>当前状态：${statusTag(c.status)}　健康：${statusTag(readiness)}</p></div><div class="channel-detail-card"><h3>近24小时</h3><p>订单：${m.orderCount ?? 0}　成功：${m.successCount ?? 0}</p><p>成功率：${m.successRate ?? 0}%　异常：${m.exceptionCount ?? 0}</p><p>交易金额：¥${money(m.orderAmount ?? 0)}</p><p>熔断：${statusTag(h.circuitState || 'CLOSED')}</p></div></div>
    <div class="channel-preflight"><div><strong>通道预检</strong><p>${detail.preflight?.ready ? `${channelProductLabel(c.paymentMethod)}基础配置完整，可以接收订单。` : '基础配置尚未满足接入条件，请根据检查项修复。'}</p></div><div class="preflight-tags"><span>主体 ${detail.preflight?.appStatus === 'ACTIVE' ? '正常' : '异常'}</span><span>绑定 ${esc(labelOf(detail.preflight?.bindingStatus || 'MISSING'))}</span><span>路由 ${detail.preflight?.routingReady ? '正常' : '异常'}</span><span>凭证 ${detail.preflight?.credentialsReady === false ? '异常' : '已配置'}</span><span>回调 ${detail.preflight?.callbackPathConfigured ? '正常' : '异常'}</span><span>JSAPI ${detail.preflight?.jsapiReady ? '正常' : '未配置'}</span></div>${detail.preflight?.jsapiChecks?.length ? `<p class="hint">公众号支付检查：${detail.preflight.jsapiChecks.map((item) => `${esc(item.mchid)} ${item.ready ? '已就绪' : '待补齐'}`).join('、')}</p>` : ''}${detail.preflight?.issues?.length ? `<p class="message error">配置问题：${detail.preflight.issues.map((item) => labelOf(item)).join('、')}</p>` : ''}</div>
    <h3 class="subsection-title">绑定商户号与关系策略</h3><div class="table-wrap"><table><thead><tr><th>商户号</th><th>凭证</th><th>状态</th><th>权重</th><th>单笔金额（分）</th><th>日限额（分）</th><th>操作</th></tr></thead><tbody>${boundMerchants.length ? boundMerchants.map((item) => `<tr><td class="mono">${esc(item.mchid)}</td><td class="mono">${esc(item.credentialRef || '-')}</td><td>${statusTag(item.status === 'ACTIVE' && item.bindingStatus === 'ACTIVE' ? 'ACTIVE' : 'DISABLED')}</td><td><input class="binding-inline-input" type="number" min="1" max="10000" value="${Number(item.routeWeight || 100)}" data-binding-weight="${esc(item.merchantId || item.id)}"></td><td><input class="binding-inline-input binding-range-input" type="number" min="1" value="${Number(item.minOrderAmount || 1)}" data-binding-min="${esc(item.merchantId || item.id)}"><input class="binding-inline-input binding-range-input" type="number" min="0" placeholder="不限" value="${Number(item.maxOrderAmount || 0) || ''}" data-binding-max="${esc(item.merchantId || item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" placeholder="不限" value="${Number(item.dailyAmountLimit || 0) || ''}" data-binding-daily="${esc(item.merchantId || item.id)}"></td><td><button class="table-button" data-save-binding="${esc(item.merchantId || item.id)}" data-channel-id="${esc(c.id)}">保存</button> <button class="table-button" data-toggle-binding="${esc(item.merchantId || item.id)}" data-channel-id="${esc(c.id)}" data-next-binding-status="${item.bindingStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}">${item.bindingStatus === 'ACTIVE' ? '停用' : '启用'}</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">暂无绑定商户号</td></tr>'}</tbody></table></div>
    <div class="channel-route-preview"><div><strong>路由预览</strong><p class="hint">输入金额查看命中的支付通道</p></div><div class="inline-tools"><input id="channelRouteAmount" type="number" min="1" placeholder="金额（分）" /><button class="primary-button" data-preview-route-channel="${esc(c.id)}">预览路由</button></div><p id="channelRoutePreviewResult" class="message"></p></div>
    <h3 class="subsection-title">授权码商 <button class="ghost-button" data-channel-platform-merchants="${esc(c.id)}">配置授权</button></h3><div class="table-wrap"><table><thead><tr><th>码商</th><th>编码</th><th>状态</th><th>权重</th><th>并发</th><th>日限额（分）</th><th>日订单</th><th>操作</th></tr></thead><tbody>${platformMerchants.length ? platformMerchants.map((item) => `<tr><td>${esc(item.name)}</td><td class="mono">${esc(item.code)}</td><td>${statusTag(item.policyStatus === 'ACTIVE' ? item.status : 'DISABLED')}</td><td><input class="binding-inline-input" type="number" min="1" value="${Number(item.routeWeight || 100)}" data-policy-weight="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.maxConcurrency || 0) || ''}" data-policy-concurrency="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.dailyAmountLimit || 0) || ''}" data-policy-daily-amount="${esc(item.id)}"></td><td><input class="binding-inline-input" type="number" min="0" value="${Number(item.dailyOrderLimit || 0) || ''}" data-policy-daily-orders="${esc(item.id)}"></td><td><button class="table-button" data-save-channel-policy="${esc(item.id)}" data-channel-id="${esc(c.id)}">保存</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">尚未授权码商</td></tr>'}</tbody></table></div>
    <h3 class="subsection-title">命中路由规则</h3><div class="table-wrap"><table><thead><tr><th>规则</th><th>金额区间</th><th>优先级</th><th>状态</th></tr></thead><tbody>${detail.routes?.length ? detail.routes.map((item) => `<tr><td>${esc(item.name)}</td><td>${item.amountMin ?? 0} - ${item.amountMax ?? '不限'}</td><td>${item.priority}</td><td>${statusTag(item.status)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">尚未配置路由规则</td></tr>'}</tbody></table></div>`;
  const bindingTitle = Array.from(panel.querySelectorAll('h3')).find((node) => node.textContent?.includes('绑定商户号')); if (bindingTitle) { bindingTitle.textContent = '已绑定商户号（由商户管理维护）'; const bindingTable = bindingTitle.nextElementSibling?.querySelector('table'); bindingTable?.querySelectorAll('th:last-child, td:last-child').forEach((node) => node.remove()); } panel.querySelectorAll('[data-binding-weight], [data-binding-min], [data-binding-max], [data-binding-daily]').forEach((node) => { node.disabled = true; });
}
async function openChannelDetail(id) { state.channelDetail = (await api(`/api/v1/admin/channels/${encodeURIComponent(id)}/detail`)).data; renderChannelDetail(); }

function ensureWechatMerchantStatsPanel() {
  if (document.querySelector('#wechatMerchantStatsModal')) return;
  document.body.insertAdjacentHTML('beforeend', '<div id="wechatMerchantStatsModal" class="modal hidden" role="dialog" aria-modal="true"><div class="modal-backdrop" data-close-wechat-merchant-stats></div><div class="modal-card channel-detail-modal-card"><div class="section-title"><div><div class="eyebrow">MERCHANT ACCOUNT WORKBENCH</div><h2 id="wechatMerchantStatsTitle">商户号数据概览</h2><p id="wechatMerchantStatsMeta" class="hint"></p></div><button type="button" class="ghost-button" data-close-wechat-merchant-stats>关闭</button></div><div id="wechatMerchantStatsBody"></div></div></div>');
}
function renderWechatMerchantStats() {
  ensureWechatMerchantStatsPanel();
  const detail = state.wechatMerchantStats; const body = document.querySelector('#wechatMerchantStatsBody');
  if (!detail || !body) return;
  setText('wechatMerchantStatsTitle', `商户号数据概览 · ${detail.merchant?.mchid || ''}`);
  setText('wechatMerchantStatsMeta', `${detail.merchant?.subjectName || ''} · 累计 ${detail.orderCount || 0} 笔订单`);
  body.innerHTML = `<div class="channel-detail-stats"><article><span>累计成功率</span><strong>${detail.successRate ?? 0}%</strong></article><article><span>累计收款</span><strong>¥${money(detail.successAmount || 0)}</strong></article><article><span>今日收款</span><strong>¥${money(detail.todaySuccessAmount || 0)}</strong></article><article><span>今日成功率</span><strong>${detail.todaySuccessRate ?? 0}%</strong></article><article><span>昨日收款</span><strong>¥${money(detail.yesterdaySuccessAmount || 0)}</strong></article><article><span>近 7 日成功率</span><strong>${detail.sevenDaySuccessRate ?? 0}%</strong></article></div><h3 class="subsection-title">通道表现</h3><div class="table-wrap"><table><thead><tr><th>通道</th><th>订单数</th><th>成功率</th><th>成功收款</th><th>通知路由</th></tr></thead><tbody>${detail.byChannel?.length ? detail.byChannel.map((item) => `<tr><td class="mono">${esc(item.channelId)}</td><td>${item.orderCount}</td><td>${item.successRate}%</td><td>¥${money(item.successAmount)}</td><td class="mono">${esc(item.notifyPath || '-')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">暂无交易数据</td></tr>'}</tbody></table></div>`;
  document.querySelector('#wechatMerchantStatsModal')?.classList.remove('hidden');
}
async function openWechatMerchantStats(id) { state.wechatMerchantStats = (await api(`/api/v1/admin/merchants/${encodeURIComponent(id)}/stats`)).data; renderWechatMerchantStats(); }

function orderRow(item) {
  const action = item.status === 'SUCCESS' ? `<button class="table-button" data-action="refund" data-order-id="${esc(item.id)}">退款</button>` : item.status === 'QR_CREATED' || item.status === 'PAYING' || item.status === 'UNKNOWN' ? `<button class="table-button" data-action="query" data-order-id="${esc(item.id)}">查单</button> <button class="table-button" data-action="close" data-order-id="${esc(item.id)}">关单</button>` : '-';
  return `<tr><td class="mono">${esc(item.platformOrderNo)}</td><td>¥${money(item.amount)}</td><td>${esc(item.subjectName)}</td><td>${esc(item.channelId)}</td><td>${statusTag(item.status)}</td><td>${date(item.createdAt)}</td><td>${action}</td></tr>`;
}
function deviceInfoCell(item) {
  const rawType = String(item.deviceType || 'UNKNOWN').toUpperCase();
  const type = ['ANDROID', 'IOS', 'WINDOWS', 'MAC', 'LINUX'].includes(rawType) ? rawType : 'UNKNOWN';
  const icon = { ANDROID: '♟', IOS: '●', WINDOWS: '⊞', MAC: '●', LINUX: '◈', UNKNOWN: '?' }[type];
  const location = [item.deviceCountry, item.deviceProvince, item.deviceCity].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  return `<div class="device-info-cell"><span class="device-icon device-${type.toLowerCase()}" title="${esc(type)}">${icon}</span><div><div><span class="mono">${esc(item.deviceIp || '未知 IP')}</span> <span>${esc(location || '未知地区')}</span></div><small class="mono">${esc(item.deviceNo || '未知设备号')}</small></div></div>`;
}
function adminOrderRow(item) {
  const action = item.status === 'SUCCESS' ? `<button class="table-button" data-order-detail-id="${esc(item.id)}">详情</button> <button class="table-button" data-action="refund" data-order-id="${esc(item.id)}">退款</button>` : ['QR_CREATED', 'PAYING', 'UNKNOWN', 'CREATED', 'ROUTED'].includes(item.status) ? `<button class="table-button" data-order-detail-id="${esc(item.id)}">详情</button> <button class="table-button" data-action="query" data-order-id="${esc(item.id)}">查单</button> <button class="table-button" data-action="close" data-order-id="${esc(item.id)}">关单</button>` : `<button class="table-button" data-order-detail-id="${esc(item.id)}">详情</button>`;
  const blockAction = `<button class="table-button danger-item" data-member-block-order-id="${esc(item.id)}">拉黑</button>`;
  const orderActions = ` <button class="table-button" data-order-callback-id="${esc(item.id)}">回调</button> <button class="table-button" data-order-supplement-id="${esc(item.id)}">补单</button>`;
  return `<tr><td class="mono">${esc(item.platformOrderNo)}</td><td class="mono">${esc(item.channelOutTradeNo)}</td><td>¥${money(item.amount)}</td><td>${esc(item.merchantName || item.merchantId)}${item.clientMerchantName ? `<br><span class="subtle">接入商户：${esc(item.clientMerchantName)}</span>` : ''}</td><td>${esc(item.subjectName)}<br><span class="subtle mono">${esc(item.channelId)}</span></td><td>${statusTag(item.status)}</td><td>${deviceInfoCell(item)}</td><td>${date(item.createdAt)}</td><td>${action}${blockAction}${orderActions}</td></tr>`;
}
function exceptionRow(item) {
  const priority = item.status === 'UNKNOWN' ? '高' : item.exceptionType === 'PAYMENT_TIMEOUT' ? '中' : '普通';
  const typeLabel = { STATUS_UNKNOWN: '状态未知', PAYMENT_FAILED: '支付失败', PAYMENT_TIMEOUT: '支付超时' }[item.exceptionType] || '异常订单';
  return `<tr><td>${priorityTag(priority)}</td><td>${typeLabel}</td><td class="mono"><button class="text-button" data-order-detail-id="${esc(item.id)}">${esc(item.platformOrderNo)}</button></td><td>¥${money(item.amount)}</td><td>${esc(item.merchantName || item.merchantId)}<br><span class="subtle mono">${esc(item.channelId)}</span></td><td>${statusTag(item.status)}</td><td>${date(item.createdAt)}</td><td><button class="table-button" data-order-detail-id="${esc(item.id)}">详情</button> <button class="table-button" data-action="query" data-order-id="${esc(item.id)}">查单</button> ${['SUCCESS', 'CLOSED'].includes(item.status) ? '' : `<button class="table-button" data-action="close" data-order-id="${esc(item.id)}">关单</button>`}</td></tr>`;
}

function renderRefundSelect() {
  const select = document.querySelector('#refundOrderSelect');
  const selected = select.value;
  select.innerHTML = state.orders.filter((item) => item.status === 'SUCCESS').map((item) => `<option value="${esc(item.id)}">${esc(item.platformOrderNo)} · ¥${money(item.amount)}</option>`).join('');
  if (selected) select.value = selected;
}

document.querySelectorAll('.nav-item:not(.nav-parent)').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('.nav-subitem:not([data-platform-tab-target])').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelector('[data-nav-toggle="platform-merchants"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  const group = document.querySelector('[data-nav-group="platform-merchants"]');
  const wasOpen = group?.classList.contains('open');
  group?.classList.toggle('open', !wasOpen);
  if (!wasOpen) switchView('platform-merchants');
});
document.querySelector('[data-nav-toggle="wechat-native"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  const group = document.querySelector('[data-nav-group="wechat-native"]');
  const wasOpen = group?.classList.contains('open');
  group?.classList.toggle('open', !wasOpen);
  if (!wasOpen) switchView('merchants');
});
document.querySelector('[data-nav-toggle="qr-mode"]')?.addEventListener('click', (event) => {
  event.preventDefault(); const group = document.querySelector('[data-nav-group="qr-mode"]'); const wasOpen = group?.classList.contains('open'); group?.classList.toggle('open', !wasOpen); if (!wasOpen) switchView('qr-codes');
});
document.querySelector('[data-nav-toggle="orders"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  const group = document.querySelector('[data-nav-group="orders"]');
  const wasOpen = group?.classList.contains('open');
  group?.classList.toggle('open', !wasOpen);
  if (!wasOpen) switchView('orders');
});
document.querySelectorAll('[data-platform-tab-target]').forEach((button) => button.addEventListener('click', () => {
  setPlatformMerchantTab(button.dataset.platformTabTarget || 'list');
  switchView('platform-merchants');
}));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.go)));
document.addEventListener('click', (event) => { const alertLink = event.target.closest('#dashboardAlerts [data-go]'); if (alertLink) switchView(alertLink.dataset.go); });
document.addEventListener('click', async (event) => {
  const openQrChannel = event.target.closest('[data-open-qr-channel]');
  if (openQrChannel) { switchView('qr-routing'); const row = document.querySelector(`#qrChannelRows [data-qr-channel-save="${CSS.escape(openQrChannel.dataset.openQrChannel)}"]`)?.closest('tr'); row?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
});
document.querySelectorAll('[data-dashboard-range]').forEach((button) => button.addEventListener('click', () => {
  const today = dashboardToday(); let from = today; let to = today; let label = '今日';
  if (button.dataset.dashboardRange === 'yesterday') { from = dashboardDateOffset(-1); to = from; label = '昨日'; }
  if (button.dataset.dashboardRange === '7d') { from = dashboardDateOffset(-6); label = '近 7 天'; }
  document.querySelector('#dashboardDateFrom').value = from; document.querySelector('#dashboardDateTo').value = to; state.dashboardRange.label = label; document.querySelectorAll('[data-dashboard-range]').forEach((item) => item.classList.toggle('active', item === button));
  loadData().catch((error) => showError(error));
}));
document.querySelector('#dashboardApplyButton')?.addEventListener('click', () => { const from = document.querySelector('#dashboardDateFrom').value; const to = document.querySelector('#dashboardDateTo').value; if (!from || !to || from > to) { showError(new Error('请选择有效的日期范围')); return; } state.dashboardRange.label = from === to ? (from === dashboardToday() ? '今日' : from === dashboardDateOffset(-1) ? '昨日' : from) : `${from} 至 ${to}`; document.querySelectorAll('[data-dashboard-range]').forEach((item) => item.classList.remove('active')); loadData().catch((error) => showError(error)); });
document.querySelector('#refreshButton').addEventListener('click', () => loadData().catch(showError));
document.querySelector('#addChannelButton')?.addEventListener('click', () => { merchantChannelBindingCreationTarget = null; openChannelModal(); });
document.querySelectorAll('#merchantForm select[name="nativeAppId"], #merchantForm select[name="jsapiAppId"]').forEach((input) => input.addEventListener('change', updateMerchantDerivedSubject));
document.querySelectorAll('#merchantForm input[name="paymentMethods"]').forEach((input) => input.addEventListener('change', () => { syncMerchantPaymentFields(); updateMerchantDerivedSubject(); }));
document.querySelector('#merchantForm input[name="mchid"]')?.addEventListener('input', () => {});
document.querySelector('#merchantCloneForm input[name="mchid"]')?.addEventListener('input', () => {});
['channelSearch', 'channelStatusFilter', 'channelHealthFilter'].forEach((id) => { const node = document.querySelector(`#${id}`); node?.addEventListener('input', render); node?.addEventListener('change', render); });
document.querySelector('#resetChannelFilters')?.addEventListener('click', () => { document.querySelector('#channelSearch').value = ''; document.querySelector('#channelStatusFilter').value = ''; document.querySelector('#channelHealthFilter').value = ''; render(); });
document.querySelector('#logoutButton').addEventListener('click', async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); showLoginGate(); document.querySelector('#logoutButton').classList.add('hidden'); });
document.querySelector('#orderRefreshButton').addEventListener('click', () => { state.orderPage = 1; loadData().catch((error) => showError(error, 'orderMessage')); });
document.querySelector('#auditSearch')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'auditMessage')));
document.querySelector('#auditReset')?.addEventListener('click', () => { ['auditActionFilter', 'auditOperatorFilter', 'auditTargetFilter', 'auditDateFrom', 'auditDateTo'].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.value = ''; }); loadData().catch((error) => showError(error, 'auditMessage')); });
function buildExportQuery(exception = false) { const params = new URLSearchParams(buildOrderQuery(exception)); params.set('page', '1'); params.set('pageSize', '200'); if (exception) params.set('exceptionOnly', '1'); return params.toString(); }
document.querySelector('#orderExportButton')?.addEventListener('click', () => { window.location.href = `/api/v1/admin/orders/export?${buildExportQuery(false)}`; });
document.querySelector('#exceptionExportButton')?.addEventListener('click', () => { window.location.href = `/api/v1/admin/orders/export?${buildExportQuery(true)}`; });
['orderQuery', 'orderStatusFilter', 'orderChannelFilter', 'orderMerchantFilter', 'orderDateFrom', 'orderDateTo', 'orderAmountMin', 'orderAmountMax'].forEach((id) => {
  const node = document.querySelector(`#${id}`); if (!node) return;
  node.addEventListener('change', () => { state.orderPage = 1; loadData().catch((error) => showError(error, 'orderMessage')); });
  node.addEventListener('keydown', (event) => { if (event.key === 'Enter') { state.orderPage = 1; loadData().catch((error) => showError(error, 'orderMessage')); } });
});
['exceptionQuery', 'exceptionStatusFilter', 'exceptionChannelFilter', 'exceptionMerchantFilter'].forEach((id) => {
  const node = document.querySelector(`#${id}`); if (!node) return;
  node.addEventListener('change', () => { state.exceptionPage = 1; loadData().catch((error) => showError(error, 'exceptionMessage')); });
  node.addEventListener('keydown', (event) => { if (event.key === 'Enter') { state.exceptionPage = 1; loadData().catch((error) => showError(error, 'exceptionMessage')); } });
});
document.querySelector('#resetOrderFilters')?.addEventListener('click', () => { ['orderQuery', 'orderStatusFilter', 'orderChannelFilter', 'orderMerchantFilter', 'orderDateFrom', 'orderDateTo', 'orderAmountMin', 'orderAmountMax'].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.value = ''; }); state.orderPage = 1; loadData().catch((error) => showError(error, 'orderMessage')); });
document.querySelector('#resetExceptionFilters')?.addEventListener('click', () => { ['exceptionQuery', 'exceptionStatusFilter', 'exceptionChannelFilter', 'exceptionMerchantFilter'].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.value = ''; }); state.exceptionPage = 1; loadData().catch((error) => showError(error, 'exceptionMessage')); });
document.querySelector('#memberBlockQuery')?.addEventListener('input', renderMemberBlocks);
document.querySelector('#memberBlockStatus')?.addEventListener('change', renderMemberBlocks);
document.querySelector('#memberBlockReset')?.addEventListener('click', () => { document.querySelector('#memberBlockQuery').value = ''; document.querySelector('#memberBlockStatus').value = ''; renderMemberBlocks(); });
document.querySelector('#batchQueryButton').addEventListener('click', async () => {
  const ids = state.exceptions.map((item) => item.id).slice(0, 50);
  if (!ids.length) return setMessage('exceptionMessage', '当前筛选没有需要批量查单的异常订单', false);
  try { const result = await api('/api/v1/admin/orders/batch-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); const summary = result.summary || {}; setMessage('exceptionMessage', `已完成 ${summary.total || ids.length} 笔查单：成功 ${summary.success || 0}，已关闭 ${summary.closed || 0}，失败 ${summary.failed || 0}，待确认 ${summary.unknown || 0}`, false); await loadData(); } catch (error) { showError(error, 'exceptionMessage'); }
});
document.querySelector('#menuButton').addEventListener('click', () => {
  document.querySelector('#sidebar').classList.toggle('open');
  document.querySelector('#sidebarOverlay').classList.toggle('open');
});
document.querySelector('#sidebarOverlay').addEventListener('click', () => {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#sidebarOverlay').classList.remove('open');
});

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    await api('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset(); document.querySelector('#loginGate').classList.add('hidden'); document.querySelector('#logoutButton').classList.remove('hidden'); setMessage('loginMessage', '', false); await loadData();
  } catch (error) { showError(error, 'loginMessage'); }
});

document.querySelector('#channelForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target); const payload = Object.fromEntries(formData.entries()); const editId = payload.editId; delete payload.editId; payload.routeWeight = Number(payload.routeWeight); if (editId) delete payload.id;
  if (!editId && merchantChannelBindingCreationTarget) payload.merchantIds = [merchantChannelBindingCreationTarget];
  try {
    const result = await api(editId ? `/api/v1/admin/channels/${encodeURIComponent(editId)}` : '/api/v1/admin/channels', { method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const createdId = String(result.data?.id || payload.id || '');
    if (!editId && merchantChannelBindingCreationTarget && createdId) {
      await api(`/api/v1/admin/merchants/${encodeURIComponent(merchantChannelBindingCreationTarget)}/channels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelIds: [createdId] }) });
      merchantChannelBindingCreationTarget = null;
      closeChannelModal(); setMessage('merchantMessage', `${payload.paymentMethod === 'JSAPI' ? '公众号支付' : 'Native'} 通道已创建并自动绑定到该商户号`, false);
    } else {
      merchantChannelBindingCreationTarget = null;
      closeChannelModal(); setMessage('channelMessage', editId ? '通道资料已更新' : '通道已创建，请到商户管理绑定可用商户号', false);
    }
    await loadData(); if (editId) await openChannelDetail(editId);
  } catch (error) { merchantChannelBindingCreationTarget = null; setMessage('channelFormMessage', error.message || String(error), true); }
});
document.querySelector('#channelRiskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const raw = Object.fromEntries(new FormData(form).entries());
  const fields = ['singleIpPaymentLimit', 'consecutiveFailureLimit', 'userIdPaymentLimit', 'dailyOrderLimit', 'floatingAmountMin', 'floatingAmountMax', 'amountMin', 'amountMax', 'dailyAmountLimit'];
  const payload = Object.fromEntries(fields.map((key) => [key, Number(raw[key] || 0)]));
  payload.regionBlacklist = String(raw.regionBlacklist || '').split(/[，,]/).map((item) => item.trim()).filter(Boolean).join(',');
  if (payload.floatingAmountMax > 0 && payload.floatingAmountMax < payload.floatingAmountMin) return setMessage('channelRiskMessage', '浮动金额最大值不能小于最小值', true);
  if (payload.amountMax > 0 && payload.amountMax < payload.amountMin) return setMessage('channelRiskMessage', '金额范围最大值不能小于最小值', true);
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try { await api(`/api/v1/admin/channels/${encodeURIComponent(raw.channelId)}/risk`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setMessage('channelRiskMessage', '风控配置已保存', false); setMessage('channelMessage', `通道 ${raw.channelId} 风控配置已更新`, false); await loadData(); }
  catch (error) { setMessage('channelRiskMessage', error.message || String(error), true); }
  finally { submit.disabled = false; }
});

document.querySelector('#subjectForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await api('/api/v1/admin/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) }); closeSubjectModal(); setMessage('subjectMessage', '主体创建成功', false); await loadData(); } catch (error) { showError(error, 'subjectFormMessage'); }
});

document.querySelector('#appForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const raw = Object.fromEntries(new FormData(form).entries()); const editingId = form.dataset.editingId;
  if (!raw.appSecret) delete raw.appSecret;
  try { await api(editingId ? `/api/v1/admin/apps/${encodeURIComponent(editingId)}` : '/api/v1/admin/apps', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingId ? { appSecret: raw.appSecret, oauthDomain: raw.oauthDomain, jsapiPath: raw.jsapiPath, verifyFile: raw.verifyFile, verifyToken: raw.verifyToken } : raw) }); closeAppModal(); setMessage('appMessage', editingId ? '公众号配置已保存' : 'AppID 创建成功', false); await loadData(); } catch (error) { showError(error, 'appFormMessage'); }
});

document.querySelector('#merchantForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const payload = Object.fromEntries(new FormData(form).entries()); payload.paymentMethods = Array.from(form.querySelectorAll('input[name="paymentMethods"]:checked')).map((input) => input.value).slice(0, 1); payload.dailyAmountLimit = Number(payload.dailyAmountLimit || 0); const editingId = form.dataset.editingId; if (editingId && !payload.apiV2Key) delete payload.apiV2Key;
  if (!payload.paymentMethods.length) { setMessage('merchantFormMessage', '至少选择一种支付方式', true); return; }
  if (!updateMerchantDerivedSubject()) { setMessage('merchantFormMessage', 'Native 应用和公众号 AppID 必须属于同一主体', true); return; }
  try { await api(editingId ? `/api/v1/admin/merchants/${encodeURIComponent(editingId)}` : '/api/v1/admin/merchants', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingId ? { apiV2Key: payload.apiV2Key, dailyAmountLimit: payload.dailyAmountLimit } : payload) }); closeMerchantModal(); setMessage('merchantMessage', editingId ? '商户号已更新' : '商户号创建成功', false); await loadData(); } catch (error) { showError(error, 'merchantFormMessage'); }
});

document.querySelector('#merchantCloneForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries()); payload.dailyAmountLimit = Number(payload.dailyAmountLimit || 0); delete payload.sourceId;
  try { await api(`/api/v1/admin/merchants/${encodeURIComponent(event.target.elements.sourceId.value)}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); closeMerchantCloneModal(); setMessage('merchantMessage', '复制成功，新商户已默认停用，请完成 APIv2 密钥和通道配置', false); await loadData(); } catch (error) { showError(error, 'merchantCloneMessage'); }
});

document.querySelector('#merchantBatchRiskForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const raw = Object.fromEntries(new FormData(form).entries());
  const payload = Object.fromEntries(['riskEnabled', 'orderWindowSeconds', 'orderWindowLimit', 'dailyOrderLimit', 'dailySuccessLimit'].map((key) => [key, Number(raw[key] || 0)]));
  if ((payload.orderWindowSeconds > 0 && payload.orderWindowLimit <= 0) || (payload.orderWindowSeconds <= 0 && payload.orderWindowLimit > 0)) {
    setMessage('merchantBatchRiskMessage', '时间窗口和窗口进单上限需要同时填写，填 0 表示同时关闭', true); return;
  }
  const ids = merchantBatchRiskTargets.slice();
  if (!ids.length) return;
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  const requests = ids.map((id) => {
    const merchant = state.merchants.find((item) => String(item.id) === String(id));
    return api(`/api/v1/admin/merchants/${encodeURIComponent(id)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyAmountLimit: Number(merchant?.dailyAmountLimit || 0), complaintCount: Number(merchant?.complaintCount || 0), ...payload }) });
  });
  try {
    const results = await Promise.allSettled(requests);
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) throw new Error(`有 ${failed.length} 个商户号保存失败`);
    const successMessage = merchantBatchRiskSingle ? '商户号进单风控已更新' : `已为 ${ids.length} 个商户号保存进单风控`;
    closeMerchantBatchRiskModal(); setMessage('merchantMessage', successMessage, false); await loadData();
  } catch (error) { showError(error, 'merchantBatchRiskMessage'); } finally { submit.disabled = false; }
});

document.querySelector('#platformMerchantForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries()); const editId = payload.editId; delete payload.editId;
  payload.settlementRate = Number(payload.settlementRate); payload.maxOrderAmount = Number(payload.maxOrderAmount); payload.dailyAmountLimit = Number(payload.dailyAmountLimit); payload.dailyOrderLimit = Number(payload.dailyOrderLimit);
  const quotaPolicy = { minOrderAmount: Number(payload.minOrderAmount), maxOrderAmount: payload.maxOrderAmount, dailyAmountLimit: payload.dailyAmountLimit, dailyOrderLimit: payload.dailyOrderLimit, pendingAmountLimit: Number(payload.pendingAmountLimit), pendingOrderLimit: Number(payload.pendingOrderLimit), warningRatio: Number(payload.warningRatio), criticalRatio: Number(payload.criticalRatio), creditWarningAmount: Number(document.querySelector('#platformMerchantCreditWarningAmount').value || 0) };
  delete payload.minOrderAmount; delete payload.pendingAmountLimit; delete payload.pendingOrderLimit; delete payload.warningRatio; delete payload.criticalRatio;
  if (editId) { delete payload.id; delete payload.username; delete payload.initialPassword; }
  try {
    const result = await api(editId ? `/api/v1/admin/platform-merchants/${encodeURIComponent(editId)}/profile` : '/api/v1/admin/platform-merchants', { method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (editId) await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(editId)}/quota`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quotaPolicy) });
    closePlatformMerchantModal(); setMessage('platformMerchantMessage', editId ? '码商资料已更新' : `创建成功，登录账号：${result.data.loginUsername || payload.username}。请通过安全方式将初始密码交给码商。`, false); await loadData();
  } catch (error) { setMessage('platformMerchantFormMessage', error.message || String(error), true); }
});

async function adjustPlatformMerchantCredit(delta) {
  const merchantId = document.querySelector('#platformMerchantEditId')?.value;
  const amount = Number(document.querySelector('#platformMerchantCreditAmount')?.value);
  if (!merchantId) return;
  if (!Number.isInteger(amount) || amount <= 0) { setMessage('platformMerchantCreditMessage', '请输入正整数金额（单位：分）', true); return; }
  const operationPassword = window.prompt('请输入操作密码：');
  if (operationPassword === null) return;
  if (!operationPassword) { setMessage('platformMerchantCreditMessage', '请输入操作密码', true); return; }
  try {
    const result = await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(merchantId)}/credit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: delta * amount, operationPassword, note: delta > 0 ? '编辑码商时增加授信额度' : '编辑码商时减少授信额度' }) });
    const account = result.data || {};
    document.querySelector('#platformMerchantCreditAmount').value = '';
    const warningAmount = state.platformMerchants.find((item) => String(item.id) === String(merchantId))?.creditWarningAmount || 0;
    document.querySelector('#platformMerchantCreditSummary').textContent = `当前余额 ¥${money(account.quotaBalance || 0)}，已用 ¥${money(account.quotaUsed || 0)}，预警额度 ¥${money(warningAmount)}，单位：分`;
    setMessage('platformMerchantCreditMessage', delta > 0 ? '授信额度已增加' : '授信额度已减少', false);
    await loadData();
  } catch (error) { setMessage('platformMerchantCreditMessage', error.message || String(error), true); }
}

document.querySelector('#platformMerchantCreditAdd')?.addEventListener('click', () => adjustPlatformMerchantCredit(1));
document.querySelector('#platformMerchantCreditSubtract')?.addEventListener('click', () => adjustPlatformMerchantCredit(-1));

function closePlatformMerchantAdjustModal() {
  document.querySelector('#platformMerchantAdjustModal')?.classList.add('hidden');
}
function openPlatformMerchantAdjustModal(merchantId) {
  const item = state.platformMerchants.find((merchant) => String(merchant.id) === String(merchantId));
  const form = document.querySelector('#platformMerchantAdjustForm');
  if (!item || !form) return;
  form.reset();
  form.elements.merchantId.value = item.id;
  form.elements.assetType.value = 'balance';
  form.elements.direction.value = 'add';
  document.querySelector('#platformMerchantAdjustTitle').textContent = `调额 · ${item.name}`;
  document.querySelector('#platformMerchantAdjustHint').textContent = `${item.code} · 余额 ¥${money(item.availableBalance)} · 预付（授信）¥${money(item.quotaBalance)}`;
  document.querySelector('#platformMerchantAdjustCurrent').innerHTML = `<span>当前余额 <b>¥${money(item.availableBalance)}</b></span><span>当前预付（授信） <b>¥${money(item.quotaBalance)}</b></span>`;
  document.querySelector('#platformMerchantAdjustMessage').textContent = '';
  document.querySelector('#platformMerchantAdjustMessage').className = 'message';
  document.querySelector('#platformMerchantAdjustModal').classList.remove('hidden');
  setTimeout(() => form.elements.amount.focus(), 0);
}
document.querySelector('#platformMerchantAdjustForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const raw = Object.fromEntries(new FormData(form).entries());
  const amount = Number(raw.amount);
  if (!Number.isInteger(amount) || amount <= 0) { setMessage('platformMerchantAdjustMessage', '请输入正整数金额（单位：分）', true); return; }
  const delta = raw.direction === 'subtract' ? -amount : amount;
  const endpoint = raw.assetType === 'prepaid' ? 'credit' : 'balance';
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(raw.merchantId)}/${endpoint}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta, note: raw.note || (raw.assetType === 'prepaid' ? '后台调额预付（授信额度）' : '后台调额余额'), operationPassword: raw.operationPassword }) });
    closePlatformMerchantAdjustModal();
    setMessage('platformMerchantMessage', `${raw.assetType === 'prepaid' ? '预付（授信额度）' : '余额'}已${delta > 0 ? '增加' : '减少'}`, false);
    await loadData();
  } catch (error) { setMessage('platformMerchantAdjustMessage', error.message || String(error), true); } finally { submit.disabled = false; }
});

document.querySelector('#refundForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.target); const orderId = form.get('orderId');
  const payload = { reason: form.get('reason') }; if (form.get('amount')) payload.amount = Number(form.get('amount'));
  try { await api(`/api/v1/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setMessage('refundMessage', '退款已提交', false); await loadData(); } catch (error) { showError(error, 'refundMessage'); }
});

document.querySelector('#orderSupplementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const raw = Object.fromEntries(new FormData(form).entries());
  if (!window.confirm('确认执行补单吗？请确认微信侧已支付成功，补单后订单将不可恢复为未支付。')) return;
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    await api(`/api/v1/admin/orders/${encodeURIComponent(raw.orderId)}/supplement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationPassword: raw.operationPassword, transactionId: raw.transactionId || undefined, note: raw.note || undefined }) });
    closeOrderSupplementModal(); setMessage('orderMessage', '订单补单成功，已标记为支付成功', false); await loadData();
  } catch (error) { setMessage('orderSupplementMessage', error.message || String(error), true); } finally { submit.disabled = false; }
});

document.querySelector('#memberBlockForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const raw = Object.fromEntries(new FormData(form).entries()); const keyTypes = Array.from(form.querySelectorAll('input[name="keyTypes"]:checked')).map((node) => node.value);
  if (!keyTypes.length) { setMessage('memberBlockFormMessage', '至少选择一个可用匹配条件', true); return; }
  if (!window.confirm('确认拉黑该会员吗？提交后将限制匹配条件对应的新订单。')) return;
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    await api(`/api/v1/admin/orders/${encodeURIComponent(raw.orderId)}/member-block`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyTypes, scopeType: raw.scopeType, durationHours: Number(raw.durationHours || 0), reason: raw.reason, operationPassword: raw.operationPassword }) });
    closeMemberBlockModal(); setMessage('memberBlockMessage', '会员已拉黑，后续匹配订单会被拦截', false); await loadData();
  } catch (error) { setMessage('memberBlockFormMessage', error.message || String(error), true); } finally { submit.disabled = false; }
});

function closeRouteRuleEditModal() { document.querySelector('#routeRuleEditModal')?.classList.add('hidden'); }
function closeRoutePreviewModal() { document.querySelector('#routePreviewModal')?.classList.add('hidden'); }
function openRoutePreviewModal() {
  setMessage('routingPreviewResult', '', false);
  document.querySelector('#routePreviewModal')?.classList.remove('hidden');
  setTimeout(() => document.querySelector('#routingPreviewAmount')?.focus(), 0);
}
function openRouteRuleEditModal(rule = null) {
  const modal = document.querySelector('#routeRuleEditModal'); const form = document.querySelector('#routeRuleEditForm');
  if (!modal || !form) return;
  form.reset();
  form.dataset.editingId = rule?.id || '';
  form.elements.name.value = rule?.name || '';
  form.elements.priority.value = rule?.priority ?? 100;
  form.elements.weight.value = rule?.weight ?? 100;
  const options = document.querySelector('#routeRuleEditChannelIds');
  options.innerHTML = state.channels.map((item) => `<option value="${esc(item.id)}">${esc(item.id)} · ${item.merchantCount ?? item.merchantIds?.length ?? 0} 个商户</option>`).join('');
  Array.from(options.options).forEach((option) => { option.selected = (rule?.channelIds || []).includes(option.value); });
  setText('routeRuleEditTitle', rule ? '编辑路由策略' : '新建路由策略');
  setText('routeRuleEditEyebrow', rule ? 'EDIT ROUTING POLICY' : 'NEW ROUTING POLICY');
  setText('routeRuleEditHint', rule ? `${rule.name || rule.id} · 当前版本 v${Number(rule.version || 1)}` : '设置优先级和候选通道，保存后立即参与动态路由。');
  const submit = form.querySelector('button[type="submit"]'); if (submit) submit.textContent = rule ? '保存修改' : '创建策略';
  setMessage('routeRuleEditMessage', '', false);
  modal.classList.remove('hidden');
  setTimeout(() => form.elements.name.focus(), 0);
}

document.querySelector('#routeRuleEditForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const raw = Object.fromEntries(new FormData(form).entries());
  const editingId = form.dataset.editingId;
  const payload = { name: raw.name, priority: Number(raw.priority), weight: Number(raw.weight), channelIds: Array.from(form.elements.channelIds.selectedOptions).map((option) => option.value) };
  const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
  try { await api(editingId ? `/api/v1/admin/routing-rules/${encodeURIComponent(editingId)}` : '/api/v1/admin/routing-rules', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); closeRouteRuleEditModal(); setMessage('routeRuleMessage', editingId ? '路由策略已更新' : '路由策略创建成功', false); await loadData(); } catch (error) { showError(error, 'routeRuleEditMessage'); } finally { submit.disabled = false; }
});

document.querySelector('#adminUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  payload.dataScopeIds = String(payload.dataScopeIds || '').split(',').map((item) => item.trim()).filter(Boolean);
  try { await api('/api/v1/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); event.target.reset(); setMessage('adminUserMessage', '管理员创建成功', false); await loadData(); } catch (error) { showError(error, 'adminUserMessage'); }
});

function setReconciliationDefaults() {
  const form = document.querySelector('#reconciliationForm');
  if (!form.elements.dateFrom.value) {
    const today = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const format = (value) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    form.elements.dateFrom.value = format(today);
    form.elements.dateTo.value = format(tomorrow);
  }
  const statementForm = document.querySelector('#statementForm');
  if (statementForm && !statementForm.elements.dateFrom.value) {
    statementForm.elements.dateFrom.value = form.elements.dateFrom.value;
    statementForm.elements.dateTo.value = form.elements.dateTo.value;
  }
}

document.querySelector('#reconciliationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (!payload.channelId) delete payload.channelId;
  try {
    const result = await api('/api/v1/admin/reconciliation/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    state.reconciliation.runs.unshift(result.data);
    state.reconciliation.detail = (await api(`/api/v1/admin/reconciliation/runs/${encodeURIComponent(result.data.id)}`)).data;
    state.reconciliation.settlement = (await api(`/api/v1/admin/settlement/report?dateFrom=${encodeURIComponent(payload.dateFrom)}&dateTo=${encodeURIComponent(payload.dateTo)}${payload.channelId ? `&channelId=${encodeURIComponent(payload.channelId)}` : ''}`)).data || [];
    setMessage('reconciliationMessage', '对账批次已生成', false); renderReconciliation();
  } catch (error) { showError(error, 'reconciliationMessage'); }
});
document.querySelector('#statementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  try { await api('/api/v1/admin/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setMessage('statementMessage', '结算单已生成', false); await loadData(); } catch (error) { showError(error, 'statementMessage'); }
});

document.querySelector('#reconciliationImportButton').addEventListener('click', async () => {
  const run = state.reconciliation.detail;
  const text = document.querySelector('#reconciliationBillJson').value.trim();
  if (!run) return setMessage('reconciliationMessage', '请先生成或选择一个对账批次', true);
  if (!text) return setMessage('reconciliationMessage', '请粘贴外部流水 JSON', true);
  try {
    const items = JSON.parse(text);
    if (!Array.isArray(items)) throw new Error('外部流水必须是 JSON 数组');
    state.reconciliation.detail = (await api(`/api/v1/admin/reconciliation/runs/${encodeURIComponent(run.id)}/bill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })).data;
    const index = state.reconciliation.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) state.reconciliation.runs[index] = { ...state.reconciliation.runs[index], summary: state.reconciliation.detail.summary };
    setMessage('reconciliationMessage', `已导入 ${items.length} 条外部流水并完成比对`, false); renderReconciliation();
  } catch (error) { showError(error, 'reconciliationMessage'); }
});

function positionFloatingMenu(trigger, panel, fallbackWidth = 150) {
  if (!trigger || !panel) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(panel.offsetWidth || 0, fallbackWidth);
  const gap = 6;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const panelHeight = panel.offsetHeight || 0;
  const top = rect.bottom + gap + panelHeight <= window.innerHeight - 8
    ? rect.bottom + gap
    : Math.max(8, rect.top - panelHeight - gap);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}
function resetFloatingMenu(panel) {
  if (!panel) return;
  panel.style.left = '';
  panel.style.top = '';
}
function selectedMerchantIds() {
  return Array.from(document.querySelectorAll('#merchantRows input[data-merchant-select]:checked')).map((input) => String(input.dataset.merchantSelect));
}
async function runMerchantBatchAction(action) {
  const ids = selectedMerchantIds();
  if (!ids.length) { setMessage('merchantMessage', '请先勾选要操作的商户号', true); return; }
  document.querySelector('#merchantBatchActions')?.removeAttribute('open');
  if (action === 'BATCH_RISK') { openMerchantBatchRiskModal(ids); return; }
  if (action === 'BIND_CHANNELS') { await openMerchantChannelModal(ids); return; }
  const merchants = ids.map((id) => state.merchants.find((item) => String(item.id) === id)).filter(Boolean);
  if (action === 'DELETE' && !window.confirm(`确认批量删除选中的 ${ids.length} 个商户号？已被订单、通道使用的商户号会删除失败。`)) return;
  const requests = ids.map((id) => action === 'DELETE'
    ? api(`/api/v1/admin/merchants/${encodeURIComponent(id)}`, { method: 'DELETE' })
    : api(`/api/v1/admin/merchants/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) }));
  const results = await Promise.allSettled(requests);
  const failed = results.filter((result) => result.status === 'rejected');
  const successCount = results.length - failed.length;
  if (failed.length) setMessage('merchantMessage', `已完成 ${successCount} 个，${failed.length} 个失败，请检查失败商户的订单、通道关系或权限`, true);
  else setMessage('merchantMessage', `已批量${action === 'ACTIVE' ? '开启' : action === 'DISABLED' ? '关闭' : '删除'} ${successCount} 个商户号`, false);
  await loadData();
}
document.addEventListener('change', (event) => {
  const selectAll = event.target.closest('[data-merchant-select-all]');
  if (!selectAll) return;
  document.querySelectorAll('#merchantRows input[data-merchant-select]').forEach((input) => { input.checked = selectAll.checked; });
});
document.addEventListener('toggle', (event) => {
  const details = event.target?.matches?.('details.row-more-menu') ? event.target : null;
  if (!details) return;
  const panel = details.querySelector('.row-more-panel');
  if (details.open) positionFloatingMenu(details.querySelector('summary'), panel, 132); else resetFloatingMenu(panel);
});

document.addEventListener('click', async (event) => {
  if (event.target.closest('#addClientMerchantButton')) { openClientMerchantModal(); return; }
  const rowMoreToggle = event.target.closest('.row-more-menu > summary');
  if (rowMoreToggle) {
    const details = rowMoreToggle.closest('.row-more-menu');
    window.setTimeout(() => {
      const panel = details?.querySelector('.row-more-panel');
      if (details?.open) positionFloatingMenu(rowMoreToggle, panel, 132); else resetFloatingMenu(panel);
    }, 0);
    return;
  }
  const clientMoreToggle = event.target.closest('[data-client-more-toggle]');
  if (clientMoreToggle) {
    const menu = clientMoreToggle.closest('.more-menu');
    document.querySelectorAll('.more-menu.open').forEach((node) => { if (node !== menu) { node.classList.remove('open'); resetFloatingMenu(node.querySelector('.more-menu-list')); } });
    menu?.classList.toggle('open');
    const panel = menu?.querySelector('.more-menu-list');
    if (menu?.classList.contains('open') && panel) positionFloatingMenu(clientMoreToggle, panel, 150); else resetFloatingMenu(panel);
    return;
  }
  const clientConnectButton = event.target.closest('[data-client-connect]');
  if (clientConnectButton) { openClientIntegration(clientConnectButton.dataset.clientConnect); return; }
  if (event.target.closest('[data-close-client-integration]')) { document.querySelector('#clientIntegrationModal')?.classList.add('hidden'); return; }
  const toggleClientPassword = event.target.closest('[data-toggle-client-password]');
  if (toggleClientPassword) { const modal = document.querySelector('#clientIntegrationModal'); const id = modal?.dataset.integrationMerchantId; if (id) { integrationVisibility[id] = { ...(integrationVisibility[id] || {}), password: !integrationVisibility[id]?.password }; openClientIntegration(id); } return; }
  const toggleClientSecret = event.target.closest('[data-toggle-client-secret]');
  if (toggleClientSecret) { const modal = document.querySelector('#clientIntegrationModal'); const id = modal?.dataset.integrationMerchantId; if (id) { integrationVisibility[id] = { ...(integrationVisibility[id] || {}), secret: !integrationVisibility[id]?.secret }; openClientIntegration(id); } return; }
  const resetClientPasswordButton = event.target.closest('[data-reset-client-password]');
  if (resetClientPasswordButton) {
    const modal = document.querySelector('#clientIntegrationModal'); const id = modal?.dataset.integrationMerchantId;
    if (!id || !window.confirm('重置后原登录密码将立即失效，确认继续吗？')) return;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; let password = 'P';
    if (window.crypto?.getRandomValues) { const bytes = new Uint8Array(11); window.crypto.getRandomValues(bytes); password += Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(''); } else password += Math.random().toString(36).slice(2, 13);
    try { await api(`/api/v1/admin/client-merchants/${encodeURIComponent(id)}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); modalPasswordCache[String(id)] = password; openClientIntegration(id); setMessage('clientIntegrationMessage', `新登录密码：${password}（仅显示本次，请立即保存）`, false); } catch (error) { showError(error, 'clientIntegrationMessage'); }
    return;
  }
  if (event.target.closest('[data-copy-client-integration]')) { const modal = document.querySelector('#clientIntegrationModal'); const text = modal?.dataset.integrationText || ''; try { await navigator.clipboard.writeText(text); setMessage('clientIntegrationMessage', '对接参数已复制', false); } catch { setMessage('clientIntegrationMessage', '浏览器禁止自动复制，请手动复制上方内容', true); } return; }
  const editClientButton = event.target.closest('[data-edit-client-id]');
  if (editClientButton) { const item = state.clientMerchants.find((x) => String(x.id) === String(editClientButton.dataset.editClientId)); if (item) openClientMerchantModal(item); return; }
  const clientDetailButton = event.target.closest('[data-client-detail-id],[data-client-more-id]');
  if (clientDetailButton) { try { await openClientMerchantDetail(clientDetailButton.dataset.clientDetailId || clientDetailButton.dataset.clientMoreId); } catch (error) { showError(error, 'clientMerchantMessage'); } return; }
  if (event.target.closest('[data-close-client-modal]')) { document.querySelector('#clientMerchantModal')?.classList.add('hidden'); return; }
  if (event.target.closest('[data-close-client-detail]')) { document.querySelector('#clientMerchantDetailDrawer')?.classList.add('hidden'); return; }
  const saveClientCodes = event.target.closest('[data-save-client-codes]');
  if (saveClientCodes) { const ids=Array.from(document.querySelectorAll('#clientCodeMerchantOptions input:checked')).map((node)=>node.value); try { await api('/api/v1/admin/client-merchants/' + encodeURIComponent(saveClientCodes.dataset.saveClientCodes) + '/code-merchants', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ platformMerchantIds: ids }) }); setMessage('clientMerchantMessage','历史码商绑定已更新，请改用通道绑定',false); await loadData(); await openClientMerchantDetail(saveClientCodes.dataset.saveClientCodes); } catch (error) { showError(error,'clientMerchantMessage'); } return; }
  const saveClientChannels = event.target.closest('[data-save-client-channels]');
  if (saveClientChannels) { const selected = Array.from(document.querySelectorAll('#clientChannelOptions input:checked')); const ids = selected.map((node) => node.value); const routeStrategies = Object.fromEntries(ids.map((channelId) => [channelId, document.querySelector(`#clientChannelOptions [data-client-channel-route-strategy="${channelId}"]`)?.value || 'HEALTH_WEIGHTED'])); try { await api('/api/v1/admin/client-merchants/' + encodeURIComponent(saveClientChannels.dataset.saveClientChannels) + '/channels', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelIds: ids, routeStrategies }) }); setMessage('clientMerchantMessage', '通道绑定和路由策略已更新', false); await loadData(); await openClientMerchantDetail(saveClientChannels.dataset.saveClientChannels); } catch (error) { showError(error, 'clientMerchantMessage'); } return; }
  const adjustClientButton = event.target.closest('[data-adjust-client-id]');
  if (adjustClientButton) { const raw=window.prompt(adjustClientButton.dataset.adjustAction === 'ADD' ? '请输入增加金额（分）：' : '请输入减少金额（分）：', '10000'); if (raw === null) return; const amount=Number(raw); if (!Number.isInteger(amount) || amount <= 0) { setMessage('clientMerchantMessage','请输入正整数金额（单位：分）',true); return; } try { await api('/api/v1/admin/client-merchants/' + encodeURIComponent(adjustClientButton.dataset.adjustClientId) + '/balance', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount, action:adjustClientButton.dataset.adjustAction, note:'后台人工调整余额' }) }); setMessage('clientMerchantMessage','余额调整成功',false); await loadData(); await openClientMerchantDetail(adjustClientButton.dataset.adjustClientId); } catch (error) { showError(error,'clientMerchantMessage'); } return; }
  const clientListStatusButton = event.target.closest('[data-client-list-status-id]');
  if (clientListStatusButton) { clientListStatusButton.disabled = true; try { await api('/api/v1/admin/client-merchants/' + encodeURIComponent(clientListStatusButton.dataset.clientListStatusId), { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:clientListStatusButton.dataset.nextClientStatus }) }); setMessage('clientMerchantMessage', `商户已${clientListStatusButton.dataset.nextClientStatus === 'ACTIVE' ? '启用' : '停用'}`, false); await loadData(); } catch (error) { showError(error,'clientMerchantMessage'); } finally { clientListStatusButton.disabled = false; } return; }
  const clientStatusButton = event.target.closest('[data-client-status-id]');
  if (clientStatusButton) { try { await api('/api/v1/admin/client-merchants/' + encodeURIComponent(clientStatusButton.dataset.clientStatusId), { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status:clientStatusButton.dataset.nextClientStatus }) }); await loadData(); await openClientMerchantDetail(clientStatusButton.dataset.clientStatusId); } catch (error) { showError(error,'clientMerchantMessage'); } return; }
  const previousPage = event.target.closest('[data-page-prev]');
  if (previousPage) { if (previousPage.dataset.pagePrev === 'orderPagination') state.orderPage = Math.max(1, state.orderPage - 1); else state.exceptionPage = Math.max(1, state.exceptionPage - 1); await loadData(); return; }
  const nextPage = event.target.closest('[data-page-next]');
  if (nextPage) { if (nextPage.dataset.pageNext === 'orderPagination') state.orderPage += 1; else state.exceptionPage += 1; await loadData(); return; }
  const orderDetailButton = event.target.closest('[data-order-detail-id]');
  if (orderDetailButton) { try { await openOrderDetail(orderDetailButton.dataset.orderDetailId); } catch (error) { showError(error, 'orderMessage'); } return; }
  const memberBlockOrderButton = event.target.closest('[data-member-block-order-id]');
  if (memberBlockOrderButton) { openMemberBlockModal(memberBlockOrderButton.dataset.memberBlockOrderId); return; }
  const revokeMemberBlockButton = event.target.closest('[data-revoke-member-block]');
  if (revokeMemberBlockButton) {
    if (!window.confirm('确认解除这条会员封禁吗？解除后该匹配条件可以再次下单。')) return;
    const operationPassword = window.prompt('请输入管理员操作密码：'); if (operationPassword === null) return;
    try { await api(`/api/v1/admin/member-blocks/${encodeURIComponent(revokeMemberBlockButton.dataset.revokeMemberBlock)}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationPassword, reason: '后台人工解封' }) }); await loadData(); } catch (error) { showError(error, 'memberBlockMessage'); }
    return;
  }
  if (event.target.closest('[data-close-member-block]')) { closeMemberBlockModal(); return; }
  const orderCallbackButton = event.target.closest('[data-order-callback-id]');
  if (orderCallbackButton) {
    if (!window.confirm('确认重新发送该订单回调吗？')) return;
    const operationPassword = window.prompt('请输入管理员操作密码：'); if (operationPassword === null) return;
    orderCallbackButton.disabled = true;
    try { await api(`/api/v1/admin/orders/${encodeURIComponent(orderCallbackButton.dataset.orderCallbackId)}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationPassword }) }); setMessage('orderMessage', '订单回调已加入发送队列', false); await loadData(); } catch (error) { showError(error, 'orderMessage'); } finally { orderCallbackButton.disabled = false; }
    return;
  }
  const orderSupplementButton = event.target.closest('[data-order-supplement-id]');
  if (orderSupplementButton) { openOrderSupplementModal(orderSupplementButton.dataset.orderSupplementId); return; }
  if (event.target.closest('[data-close-order-supplement]')) { closeOrderSupplementModal(); return; }
  if (event.target.closest('[data-close-order-detail]')) { state.orderDetail = null; renderOrderDetail(); return; }
  const exceptionActionButton = event.target.closest('[data-exception-action]');
  if (exceptionActionButton) {
    const action = exceptionActionButton.dataset.exceptionAction; const id = exceptionActionButton.dataset.exceptionOrderId;
    if (action === 'CLOSE' && !window.confirm('确认关闭该订单吗？请先确认微信侧未支付成功。')) return;
    const operationPassword = action === 'QUERY' ? undefined : window.prompt('请输入管理员操作密码：'); if (action !== 'QUERY' && operationPassword === null) return;
    exceptionActionButton.disabled = true;
    try { await api(`/api/v1/admin/orders/${encodeURIComponent(id)}/exception-action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, operationPassword }) }); await openOrderDetail(id); await loadData(); } catch (error) { showError(error, 'orderMessage'); } finally { exceptionActionButton.disabled = false; }
    return;
  }
  if (event.target.closest('#addPlatformMerchantButton')) { openPlatformMerchantModal(); return; }
  if (event.target.closest('[data-close-platform-adjust]')) { closePlatformMerchantAdjustModal(); return; }
  const adjustPlatformMerchant = event.target.closest('[data-adjust-platform-merchant-id]');
  if (adjustPlatformMerchant) { openPlatformMerchantAdjustModal(adjustPlatformMerchant.dataset.adjustPlatformMerchantId); return; }
  const transferPrepaidButton = event.target.closest('[data-transfer-prepaid-id]');
  if (transferPrepaidButton) {
    const amountRaw = window.prompt('请输入转入预付金额（分）：', '10000');
    if (amountRaw === null) return;
    const amount = Number(amountRaw);
    if (!Number.isInteger(amount) || amount <= 0) { setMessage('platformMerchantMessage', '请输入正整数金额（单位：分）', true); return; }
    const operationPassword = window.prompt('请输入操作密码：');
    if (operationPassword === null) return;
    if (!operationPassword) { setMessage('platformMerchantMessage', '请输入操作密码', true); return; }
    transferPrepaidButton.disabled = true;
    try { await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(transferPrepaidButton.dataset.transferPrepaidId)}/transfer-prepaid`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, operationPassword, note: '代收余额转入预付' }) }); setMessage('platformMerchantMessage', `已转入预付 ¥${money(amount)}`, false); await loadData(); }
    catch (error) { showError(error, 'platformMerchantMessage'); } finally { transferPrepaidButton.disabled = false; }
    return;
  }
  if (event.target.closest('[data-platform-adjust-history]')) {
    const merchantId = document.querySelector('#platformMerchantAdjustForm')?.elements.merchantId?.value;
    closePlatformMerchantAdjustModal();
    setPlatformMerchantTab('ledger');
    const filter = document.querySelector('#platformLedgerMerchantFilter'); if (filter && merchantId) filter.value = merchantId;
    void loadPlatformMerchantFinance();
    return;
  }
  if (event.target.closest('#addSubjectButton')) { openSubjectModal(); return; }
  if (event.target.closest('[data-close-subject-modal]')) { closeSubjectModal(); return; }
  if (event.target.closest('#addAppButton')) { openAppModal(); return; }
  if (event.target.closest('[data-close-app-modal]')) { closeAppModal(); return; }
  if (event.target.closest('#addMerchantButton')) { openMerchantModal(); return; }
  const merchantBatchAction = event.target.closest('[data-merchant-batch-action]');
  if (merchantBatchAction) { try { await runMerchantBatchAction(merchantBatchAction.dataset.merchantBatchAction); } catch (error) { showError(error, 'merchantMessage'); } return; }
  if (event.target.closest('[data-close-merchant-modal]')) { closeMerchantModal(); return; }
  if (event.target.closest('[data-close-merchant-clone]')) { closeMerchantCloneModal(); return; }
  if (event.target.closest('[data-close-merchant-batch-risk]')) { closeMerchantBatchRiskModal(); return; }
  if (event.target.closest('[data-close-merchant-channel-modal]')) { closeMerchantChannelModal(); return; }
  if (event.target.closest('[data-close-wechat-merchant-stats]')) { document.querySelector('#wechatMerchantStatsModal')?.classList.add('hidden'); state.wechatMerchantStats = null; return; }
  const merchantStatsButton = event.target.closest('[data-merchant-stats]');
  if (merchantStatsButton) { try { await openWechatMerchantStats(merchantStatsButton.dataset.merchantStats); } catch (error) { showError(error, 'merchantMessage'); } return; }
  const merchantCopyButton = event.target.closest('[data-merchant-copy]');
  if (merchantCopyButton) { const merchant = state.merchants.find((item) => String(item.id) === String(merchantCopyButton.dataset.merchantCopy)); if (merchant) openMerchantCloneModal(merchant); return; }
  const merchantEditButton = event.target.closest('[data-merchant-edit]');
  if (merchantEditButton) { const merchant = state.merchants.find((item) => String(item.id) === String(merchantEditButton.dataset.merchantEdit)); if (merchant) openMerchantModal(merchant); return; }
  const merchantRiskSettingsButton = event.target.closest('[data-merchant-risk-settings]');
  if (merchantRiskSettingsButton) { openMerchantBatchRiskModal([merchantRiskSettingsButton.dataset.merchantRiskSettings], { single: true }); return; }
  const merchantDeleteButton = event.target.closest('[data-merchant-delete]');
  if (merchantDeleteButton) {
    const merchant = state.merchants.find((item) => String(item.id) === String(merchantDeleteButton.dataset.merchantDelete));
    if (!merchant || !window.confirm(`确认删除商户号 ${merchant.mchid}？仅未被订单、通道使用的商户号可以删除。`)) return;
    try { await api(`/api/v1/admin/merchants/${encodeURIComponent(merchant.id)}`, { method: 'DELETE' }); setMessage('merchantMessage', '商户号已删除', false); await loadData(); } catch (error) { showError(error, 'merchantMessage'); }
    return;
  }
  const merchantOrdersButton = event.target.closest('[data-merchant-orders]');
  if (merchantOrdersButton) {
    switchView('orders');
    const orderQuery = document.querySelector('#orderQuery');
    if (orderQuery) orderQuery.value = merchantOrdersButton.dataset.merchantMchid || '';
    state.orderPage = 1;
    await loadData();
    return;
  }
  const merchantPaymentTestButton = event.target.closest('[data-merchant-payment-test]');
  if (merchantPaymentTestButton) {
    const merchant = state.merchants.find((item) => String(item.id) === String(merchantPaymentTestButton.dataset.merchantPaymentTest));
    openMerchantPaymentTestModal(merchant);
    return;
  }
  if (event.target.closest('[data-close-merchant-payment-test]')) { closeMerchantPaymentTestModal(); return; }
  const copyMerchantPaymentUrl = event.target.closest('[data-copy-merchant-payment-url]');
  if (copyMerchantPaymentUrl) {
    const url = String(copyMerchantPaymentUrl.dataset.copyMerchantPaymentUrl || '');
    try { await navigator.clipboard.writeText(url); setMessage('merchantPaymentTestMessage', '支付链接已复制', false); } catch { setMessage('merchantPaymentTestMessage', url, false); }
    return;
  }
  if (event.target.closest('[data-refresh-merchant-payment-test]')) { await refreshMerchantPaymentTestStatus(); return; }
  const merchantWeightButton = event.target.closest('[data-merchant-weight]');
  if (merchantWeightButton) {
    switchView('channels');
    setMessage('channelMessage', '轮询权重在支付通道的编辑配置中维护，商户号只负责绑定可用通道。', false);
    return;
  }
  const bindChannelsForMerchant = event.target.closest('[data-bind-channels-for-merchant]');
  if (bindChannelsForMerchant) { await openMerchantChannelModal(bindChannelsForMerchant.dataset.bindChannelsForMerchant); return; }
  const createChannelForMerchant = event.target.closest('[data-create-channel-for-merchant]');
  if (createChannelForMerchant) {
    const merchant = state.merchants.find((item) => String(item.id) === String(createChannelForMerchant.dataset.createChannelForMerchant));
    if (!merchant) return;
    merchantChannelBindingCreationTarget = String(merchant.id);
    closeMerchantChannelModal();
    openChannelModal({ subjectId: merchant.subjectId, appInternalId: merchant.appId, merchantInternalId: merchant.id, routeWeight: 100 });
    setMessage('channelFormMessage', `正在为 ${merchant.mchid} 创建通道，保存后会自动绑定；所属产品请在表单中选择。`, false);
    return;
  }
  const saveBindingButton = event.target.closest('[data-save-binding]');
  if (saveBindingButton) {
    const channelId = saveBindingButton.dataset.channelId; const merchantId = saveBindingButton.dataset.saveBinding;
    const row = saveBindingButton.closest('tr');
    const number = (selector) => { const value = row?.querySelector(selector)?.value; return value === '' || value == null ? undefined : Number(value); };
    saveBindingButton.disabled = true;
    try {
      await api(`/api/v1/admin/channels/${encodeURIComponent(channelId)}/merchants/${encodeURIComponent(merchantId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeWeight: number('[data-binding-weight]'), minOrderAmount: number('[data-binding-min]'), maxOrderAmount: number('[data-binding-max]') || 0, dailyAmountLimit: number('[data-binding-daily]') || 0 }) });
      setMessage('channelMessage', `商户号 ${merchantId} 的通道策略已保存`, false);
      await openChannelDetail(channelId);
    } catch (error) { showError(error, 'channelMessage'); } finally { saveBindingButton.disabled = false; }
    return;
  }
  const saveChannelPolicyButton = event.target.closest('[data-save-channel-policy]');
  if (saveChannelPolicyButton) {
    const channelId = saveChannelPolicyButton.dataset.channelId; const row = saveChannelPolicyButton.closest('tr');
    const value = (selector) => { const raw = row?.querySelector(selector)?.value; return raw === '' || raw == null ? 0 : Number(raw); };
    const current = state.channelDetail?.platformMerchants || [];
    const policy = current.map((item) => String(item.id) === String(saveChannelPolicyButton.dataset.saveChannelPolicy) ? { platformMerchantId: String(item.id), status: item.policyStatus || 'ACTIVE', routeWeight: value('[data-policy-weight]'), maxConcurrency: value('[data-policy-concurrency]'), dailyAmountLimit: value('[data-policy-daily-amount]'), dailyOrderLimit: value('[data-policy-daily-orders]') } : { platformMerchantId: String(item.id), status: item.policyStatus || 'ACTIVE', routeWeight: Number(item.routeWeight || 100), maxConcurrency: Number(item.maxConcurrency || 0), dailyAmountLimit: Number(item.dailyAmountLimit || 0), dailyOrderLimit: Number(item.dailyOrderLimit || 0) });
    saveChannelPolicyButton.disabled = true;
    try { await api(`/api/v1/admin/channels/${encodeURIComponent(channelId)}/platform-merchants/policies`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policies: policy }) }); setMessage('channelMessage', '码商路由策略已保存', false); await openChannelDetail(channelId); } catch (error) { showError(error, 'channelMessage'); } finally { saveChannelPolicyButton.disabled = false; }
    return;
  }
  const toggleBindingButton = event.target.closest('[data-toggle-binding]');
  if (toggleBindingButton) {
    try { await api(`/api/v1/admin/channels/${encodeURIComponent(toggleBindingButton.dataset.channelId)}/merchants/${encodeURIComponent(toggleBindingButton.dataset.toggleBinding)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bindingStatus: toggleBindingButton.dataset.nextBindingStatus }) }); setMessage('channelMessage', '商户号通道关系状态已更新', false); await openChannelDetail(toggleBindingButton.dataset.channelId); } catch (error) { showError(error, 'channelMessage'); }
    return;
  }
  const saveMerchantChannelBindingsButton = event.target.closest('#saveMerchantChannelBindings');
  if (saveMerchantChannelBindingsButton) {
    const merchantIds = merchantChannelBindingTargets.length ? merchantChannelBindingTargets : (merchantChannelBindingTarget ? [merchantChannelBindingTarget] : []);
    if (!merchantIds.length) return;
    const channelIds = Array.from(document.querySelectorAll('#merchantChannelOptions input[type="checkbox"]:checked')).map((input) => input.value);
    saveMerchantChannelBindingsButton.disabled = true;
    try {
      const results = await Promise.allSettled(merchantIds.map((merchantId) => api(`/api/v1/admin/merchants/${encodeURIComponent(merchantId)}/channels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelIds }) })));
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) throw new Error(`有 ${failed.length} 个商户号绑定失败，请检查主体和通道配置`);
      closeMerchantChannelModal();
      setMessage('merchantMessage', `${merchantIds.length > 1 ? '批量' : ''}通道绑定已保存，共 ${merchantIds.length} 个商户号、${channelIds.length} 个通道`, false);
      await loadData();
    } catch (error) { showError(error, 'merchantChannelMessage'); } finally { saveMerchantChannelBindingsButton.disabled = false; }
    return;
  }
  if (event.target.closest('[data-close-platform-modal]')) { closePlatformMerchantModal(); return; }
  if (event.target.closest('[data-close-platform-channels-modal]')) { closePlatformMerchantChannelsModal(); return; }
  if (event.target.closest('[data-close-channel-merchant-auth]')) { closeChannelMerchantAuthModal(); return; }
  const saveChannelMerchantAuthButton = event.target.closest('#saveChannelMerchantAuth');
  if (saveChannelMerchantAuthButton) {
    if (!channelMerchantAuthTarget) return;
    const channelId = channelMerchantAuthTarget;
    const platformMerchantIds = Array.from(document.querySelectorAll('#channelMerchantAuthOptions input[type="checkbox"]:checked')).map((input) => input.value);
    saveChannelMerchantAuthButton.disabled = true;
    try {
      await api(`/api/v1/admin/channels/${encodeURIComponent(channelId)}/platform-merchants`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platformMerchantIds }) });
      closeChannelMerchantAuthModal();
      setMessage('channelMessage', `已保存码商授权，共 ${platformMerchantIds.length} 个码商`, false);
      await loadData();
      if (state.channelDetail?.channel?.id === channelId) await openChannelDetail(channelId);
    } catch (error) { showError(error, 'channelMerchantAuthMessage'); } finally { saveChannelMerchantAuthButton.disabled = false; }
    return;
  }
  const savePlatformMerchantChannelsButton = event.target.closest('#savePlatformMerchantChannels');
  if (savePlatformMerchantChannelsButton) {
    if (!platformMerchantChannelTarget) return;
    const merchantId = platformMerchantChannelTarget;
    const channelIds = Array.from(document.querySelectorAll('#platformMerchantChannelOptions input[type="checkbox"]:checked')).map((input) => input.value);
    savePlatformMerchantChannelsButton.disabled = true;
    try {
      await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(merchantId)}/channels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelIds }) });
      closePlatformMerchantChannelsModal();
      setMessage('platformMerchantMessage', `已保存通道授权，共 ${channelIds.length} 个通道`, false);
      await loadData();
      if (state.platformMerchantDetail?.id === merchantId) await openPlatformMerchantDetail(merchantId);
    } catch (error) { showError(error, 'platformMerchantChannelsMessage'); } finally { savePlatformMerchantChannelsButton.disabled = false; }
    return;
  }
  if (event.target.closest('[data-close-channel-modal]')) { closeChannelModal(); return; }
  if (event.target.closest('[data-close-channel-risk]')) { closeChannelRiskModal(); return; }
  const channelRiskButton = event.target.closest('[data-channel-risk-id]');
  if (channelRiskButton) { try { await openChannelRiskModal(channelRiskButton.dataset.channelRiskId); } catch (error) { showError(error, 'channelMessage'); } return; }
  const channelDetailButton = event.target.closest('[data-channel-detail-id]');
  if (channelDetailButton) { try { await openChannelDetail(channelDetailButton.dataset.channelDetailId); } catch (error) { showError(error, 'channelMessage'); } return; }
  const channelPlatformMerchants = event.target.closest('[data-channel-platform-merchants]');
  if (channelPlatformMerchants) { try { await openChannelMerchantAuthModal(channelPlatformMerchants.dataset.channelPlatformMerchants); } catch (error) { showError(error, 'channelMessage'); } return; }
  const editChannelButton = event.target.closest('[data-edit-channel-id]');
  if (editChannelButton) { const item = state.channels.find((channel) => String(channel.id) === String(editChannelButton.dataset.editChannelId)); if (item) openChannelModal(item); return; }
  if (event.target.closest('[data-close-channel-detail]')) { state.channelDetail = null; renderChannelDetail(); return; }
  const preflightButton = event.target.closest('[data-channel-preflight]');
  if (preflightButton) { try { state.channelPreflights[preflightButton.dataset.channelPreflight] = (await api(`/api/v1/admin/channels/${encodeURIComponent(preflightButton.dataset.channelPreflight)}/preflight`)).data; if (state.channelDetail?.channel.id === preflightButton.dataset.channelPreflight) { state.channelDetail.preflight = state.channelPreflights[preflightButton.dataset.channelPreflight]; renderChannelDetail(); } render(); setMessage('channelMessage', '通道预检已完成', false); } catch (error) { showError(error, 'channelMessage'); } return; }
  const resetChannelHealthButton = event.target.closest('[data-reset-channel-health-id]');
  if (resetChannelHealthButton) { try { await api(`/api/v1/admin/channel-health/${encodeURIComponent(resetChannelHealthButton.dataset.resetChannelHealthId)}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('channelMessage', '通道熔断已恢复', false); await loadData(); } catch (error) { showError(error, 'channelMessage'); } return; }
  const previewRouteButton = event.target.closest('[data-preview-route-channel]');
  if (previewRouteButton) { const amount = Number(document.querySelector('#channelRouteAmount')?.value); if (!amount) { setMessage('channelRoutePreviewResult', '请输入金额（分）', true); return; } const channelId = previewRouteButton.dataset.previewRouteChannel; const channel = state.channels.find((item) => String(item.id) === String(channelId)); try { const result = await api('/api/v1/admin/routing/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, channelId, paymentMethod: channel?.paymentMethod || 'NATIVE' }) }); const data = result.data; const rules = data.matchedRules?.length ? `命中规则：${data.matchedRules.map((item) => item.name).join('、')}` : '未命中特定规则'; const candidates = data.candidates?.length ? `候选：${data.candidates.map((item) => `${item.id}${item.ready ? '（可用）' : '（待完善）'}`).join('、')}` : '无候选通道'; setMessage('channelRoutePreviewResult', `命中通道 ${data.selectedChannelId} · ${data.preflight?.ready ? '预检通过' : '预检未通过'}；${rules}；${candidates}`, false); } catch (error) { showError(error, 'channelRoutePreviewResult'); } return; }
  const routingPreviewButton = event.target.closest('[data-preview-routing]');
  if (routingPreviewButton) {
    const amount = Number(document.querySelector('#routingPreviewAmount')?.value || 0);
    const channelId = document.querySelector('#routingPreviewChannel')?.value || undefined;
    if (!Number.isInteger(amount) || amount <= 0) { setMessage('routingPreviewResult', '请输入大于 0 的整数金额（单位：分）', true); return; }
    routingPreviewButton.disabled = true;
    try {
      const selectedChannel = state.channels.find((item) => String(item.id) === String(channelId));
      const result = await api('/api/v1/admin/routing/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, channelId, paymentMethod: selectedChannel?.paymentMethod || 'NATIVE' }) });
      const data = result.data || {};
      const rules = data.matchedRules?.length ? data.matchedRules.map((item) => `${item.name}（优先级 ${item.priority}）`).join('、') : '未命中特定规则，将按默认通道权重选择';
      const candidates = data.candidates?.length ? data.candidates.map((item) => `${item.id}${item.ready ? '（可用）' : '（待完善）'}`).join('、') : '暂无可用候选通道';
      setMessage('routingPreviewResult', `最终通道：${data.selectedChannelId || '-'} · ${data.preflight?.ready ? '预检通过' : '预检未通过'}；${rules}；候选：${candidates}`, false);
    } catch (error) { showError(error, 'routingPreviewResult'); } finally { routingPreviewButton.disabled = false; }
    return;
  }
  const editPlatformMerchant = event.target.closest('[data-edit-platform-merchant-id]');
  if (editPlatformMerchant) { const item = state.platformMerchants.find((merchant) => String(merchant.id) === String(editPlatformMerchant.dataset.editPlatformMerchantId)); if (item) openPlatformMerchantModal(item); return; }
  const approveRefund = event.target.closest('[data-refund-approve]');
  if (approveRefund) { try { await api(`/api/v1/admin/refunds/${encodeURIComponent(approveRefund.dataset.refundApprove)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadData(); } catch (error) { showError(error, 'refundMessage'); } return; }
  const rejectRefund = event.target.closest('[data-refund-reject]');
  if (rejectRefund) { const reason = window.prompt('请输入驳回原因：', '资料不完整'); if (!reason) return; try { await api(`/api/v1/admin/refunds/${encodeURIComponent(rejectRefund.dataset.refundReject)}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); await loadData(); } catch (error) { showError(error, 'refundMessage'); } return; }
  const reconButton = event.target.closest('[data-recon-id]');
  if (reconButton) { try { state.reconciliation.detail = (await api(`/api/v1/admin/reconciliation/runs/${encodeURIComponent(reconButton.dataset.reconId)}`)).data; renderReconciliation(); } catch (error) { showError(error, 'reconciliationMessage'); } return; }
  const callbackRetryButton = event.target.closest('[data-callback-retry]');
  if (callbackRetryButton) { callbackRetryButton.disabled = true; try { const result = await api('/api/v1/admin/callback-retry/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('callbackMessage', `已扫描 ${result.data?.scanned ?? 0} 条任务，成功 ${result.data?.succeeded ?? 0} 条，失败 ${result.data?.failed ?? 0} 条`, false); await loadData(); } catch (error) { showError(error, 'callbackMessage'); } finally { callbackRetryButton.disabled = false; } return; }
  const recoveryButton = event.target.closest('[data-recovery-action]');
  if (recoveryButton) {
    const action = recoveryButton.dataset.recoveryAction;
    const paths = { payment: '/api/v1/admin/payment-recovery/run', refund: '/api/v1/admin/refund-recovery/run', callback: '/api/v1/admin/callback-retry/run' };
    const path = paths[action]; if (!path) return;
    recoveryButton.disabled = true;
    try { const result = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const data = result.data || {}; setMessage('reconciliationMessage', `${action === 'payment' ? '查单' : action === 'refund' ? '退款恢复' : '回调重试'}已执行：扫描 ${data.scanned ?? 0} 条，更新 ${data.updated ?? data.succeeded ?? 0} 条，关单 ${data.closed ?? 0} 条，失败 ${data.failed ?? 0} 条`, false); await loadData(); } catch (error) { showError(error, 'reconciliationMessage'); } finally { recoveryButton.disabled = false; }
    return;
  }
  const resolveButton = event.target.closest('[data-recon-resolve]');
  if (resolveButton) { const note = window.prompt('请输入处理说明：', '已人工核对'); if (!note) return; try { await api(`/api/v1/admin/reconciliation/items/${encodeURIComponent(resolveButton.dataset.reconResolve)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: resolveButton.dataset.reconResolution, note }) }); if (state.reconciliation.detail) { state.reconciliation.detail = (await api(`/api/v1/admin/reconciliation/runs/${encodeURIComponent(state.reconciliation.detail.id)}`)).data; renderReconciliation(); } } catch (error) { showError(error, 'reconciliationMessage'); } return; }
  const channelButton = event.target.closest('[data-channel-id]');
  if (channelButton) { try { await api(`/api/v1/channels/${encodeURIComponent(channelButton.dataset.channelId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: channelButton.dataset.nextStatus }) }); await loadData(); } catch (error) { showError(error); } return; }
  const healthButton = event.target.closest('[data-health-id]');
  if (healthButton) { try { await api(`/api/v1/admin/channel-health/${encodeURIComponent(healthButton.dataset.healthId)}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadData(); } catch (error) { showError(error); } return; }
  const appButton = event.target.closest('[data-app-id]');
  if (appButton) { try { await api(`/api/v1/admin/apps/${encodeURIComponent(appButton.dataset.appId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: appButton.dataset.nextStatus }) }); await loadData(); } catch (error) { showError(error, 'appMessage'); } return; }
  const appEditButton = event.target.closest('[data-app-edit-id]');
  if (appEditButton) { const item = state.apps.find((entry) => String(entry.id) === String(appEditButton.dataset.appEditId)); if (item) openAppModal(item); return; }
  const merchantDetailButton = event.target.closest('[data-platform-detail-id]');
  if (merchantDetailButton) { try { await openPlatformMerchantDetail(merchantDetailButton.dataset.platformDetailId); } catch (error) { showError(error, 'platformMerchantMessage'); } return; }
  const detailToggle = event.target.closest('[data-toggle-platform-detail]');
  if (detailToggle) { const panel = document.querySelector('#platformMerchantDetail'); const details = panel ? Array.from(panel.querySelectorAll('details.detail-section')) : []; const shouldCollapse = detailToggle.dataset.state !== 'collapsed'; details.forEach((item) => { item.open = !shouldCollapse; }); detailToggle.dataset.state = shouldCollapse ? 'collapsed' : 'expanded'; detailToggle.textContent = shouldCollapse ? '全部展开' : '全部收起'; return; }
  const closeMerchantDetail = event.target.closest('[data-close-platform-detail]');
  if (closeMerchantDetail) { state.platformMerchantDetail = null; renderPlatformMerchantDetail(); return; }
  const merchantDailyLimitButton = event.target.closest('[data-merchant-daily-limit]');
  if (merchantDailyLimitButton) {
    const merchant = state.merchants.find((item) => String(item.id) === String(merchantDailyLimitButton.dataset.merchantDailyLimit));
    if (!merchant) return;
    const current = Number(merchant.dailyAmountLimit || 0);
    const raw = window.prompt('请输入每日限额（分），输入 0 表示不限额：', String(current));
    if (raw === null) return;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) { setMessage('merchantMessage', '请输入大于等于 0 的整数金额（单位：分）', true); return; }
    try { await api(`/api/v1/admin/merchants/${encodeURIComponent(merchant.id)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyAmountLimit: value }) }); setMessage('merchantMessage', '每日限额已更新', false); await loadData(); } catch (error) { showError(error, 'merchantMessage'); }
    return;
  }
  const merchantForceEnableButton = event.target.closest('[data-merchant-force-enable]');
  if (merchantForceEnableButton) {
    if (!window.confirm('该商户号由监控锁定，只有超级管理员可以强制开启。确认继续吗？')) return;
    merchantForceEnableButton.disabled = true;
    try {
      await api(`/api/v1/admin/merchants/${encodeURIComponent(merchantForceEnableButton.dataset.merchantForceEnable)}/force-enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setMessage('merchantMessage', '商户号已由超级管理员强制开启，监控锁定已解除', false);
      await loadData();
    } catch (error) { showError(error, 'merchantMessage'); }
    finally { merchantForceEnableButton.disabled = false; }
    return;
  }
  const merchantButton = event.target.closest('[data-merchant-id]');
  if (merchantButton) { try { await api(`/api/v1/admin/merchants/${encodeURIComponent(merchantButton.dataset.merchantId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: merchantButton.dataset.nextStatus }) }); await loadData(); } catch (error) { showError(error, 'merchantMessage'); } return; }
  const merchantRiskButton = event.target.closest('[data-merchant-risk-id]');
  if (merchantRiskButton) { merchantRiskButton.disabled = true; try { await api(`/api/v1/admin/merchants/${encodeURIComponent(merchantRiskButton.dataset.merchantRiskId)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ riskEnabled: Number(merchantRiskButton.dataset.nextRiskEnabled) }) }); setMessage('merchantMessage', `进单风控已${Number(merchantRiskButton.dataset.nextRiskEnabled) ? '启用' : '关闭'}`, false); await loadData(); } catch (error) { showError(error, 'merchantMessage'); } finally { merchantRiskButton.disabled = false; } return; }
  const platformMerchantButton = event.target.closest('[data-platform-merchant-id]');
  if (platformMerchantButton) { const reason = platformMerchantButton.classList.contains('merchant-switch') ? (platformMerchantButton.dataset.nextStatus === 'ACTIVE' ? '支付开关开启' : '支付开关关闭') : window.prompt('请输入状态变更原因：', platformMerchantButton.dataset.nextStatus === 'ACTIVE' ? '恢复接入' : '运营暂停'); if (reason === null) return; try { await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(platformMerchantButton.dataset.platformMerchantId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: platformMerchantButton.dataset.nextStatus, reason: reason || '未填写' }) }); await loadData(); } catch (error) { showError(error, 'platformMerchantMessage'); } return; }
  const prepaidToggle = event.target.closest('[data-platform-prepaid-toggle-id]');
  if (prepaidToggle) {
    prepaidToggle.disabled = true;
    try { await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(prepaidToggle.dataset.platformPrepaidToggleId)}/quota`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: Number(prepaidToggle.dataset.nextEnabled) }) }); setMessage('platformMerchantMessage', `代收预付已${prepaidToggle.dataset.nextEnabled === '1' ? '启用' : '停用'}`, false); await loadData(); }
    catch (error) { showError(error, 'platformMerchantMessage'); } finally { prepaidToggle.disabled = false; }
    return;
  }
  const bindButton = event.target.closest('[data-bind-platform-merchant-id]');
  if (bindButton) { try { await openPlatformMerchantChannelsModal(bindButton.dataset.bindPlatformMerchantId); } catch (error) { showError(error, 'platformMerchantMessage'); } return; }
  const addWechatBinding = event.target.closest('[data-add-wechat-binding]');
  if (addWechatBinding) { const detail = state.platformMerchantDetail; if (!detail) return; const key = window.prompt('请输入要绑定的微信商户号（mchid）：'); if (!key) return; const merchant = state.merchants.find((item) => String(item.mchid) === String(key) || String(item.id) === String(key)); if (!merchant) { setMessage('merchantCreditMessage', '未找到该微信商户号，请先在商户号管理中完成配置', true); return; } if (!state.platformMerchantWechatBindings.some((item) => String(item.id) === String(merchant.id))) state.platformMerchantWechatBindings.push({ id: merchant.id, mchid: merchant.mchid, merchantStatus: merchant.status, status: 'ACTIVE', routeWeight: 100, maxConcurrency: 0, minOrderAmount: 1, maxOrderAmount: 0, dailyAmountLimit: 0, dailyOrderLimit: 0 }); renderPlatformMerchantDetail(); return; }
  const saveWechatBindings = event.target.closest('[data-save-wechat-bindings]');
  if (saveWechatBindings) { const detail = state.platformMerchantDetail; if (!detail) return; const bindings = state.platformMerchantWechatBindings.map((item) => { const row = document.querySelector(`#merchantWechatBindingRows [data-wechat-binding-weight="${item.id}"]`)?.closest('tr'); const number = (selector, fallback = 0) => { const raw = row?.querySelector(selector)?.value; return raw === '' || raw == null ? fallback : Number(raw); }; return { wechatMerchantId: String(item.id), status: item.status || 'ACTIVE', routeWeight: number('[data-wechat-binding-weight]', 100), maxConcurrency: number('[data-wechat-binding-concurrency]'), minOrderAmount: number('[data-wechat-binding-min]', 1), maxOrderAmount: number('[data-wechat-binding-max]'), dailyAmountLimit: number('[data-wechat-binding-daily]'), dailyOrderLimit: number('[data-wechat-binding-orders]') }; }); saveWechatBindings.disabled = true; try { await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(detail.id)}/wechat-merchants`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bindings }) }); setMessage('merchantCreditMessage', '码商名下商户号绑定已保存', false); await openPlatformMerchantDetail(detail.id); } catch (error) { showError(error, 'merchantCreditMessage'); } finally { saveWechatBindings.disabled = false; } return; }
  const rotateClientKeyButton = event.target.closest('[data-rotate-client-key]');
  if (rotateClientKeyButton) { if (!window.confirm('重置后旧 API Key 将立即失效，确认继续吗？')) return; try { const result = await api(`/api/v1/admin/client-merchants/${encodeURIComponent(rotateClientKeyButton.dataset.rotateClientKey)}/rotate-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const rotatedKey = result.data?.apiKey; if (rotatedKey) state.clientApiKeys[String(rotateClientKeyButton.dataset.rotateClientKey)] = rotatedKey; setMessage('clientMerchantMessage', `客户端 API Key 已重置：${rotatedKey || ''}（仅显示本次，请立即保存）`, false); } catch (error) { showError(error, 'clientMerchantMessage'); } return; }
  const creditButton = event.target.closest('[data-credit-add],[data-credit-subtract]');
  if (creditButton) { const detail = state.platformMerchantDetail; if (!detail) return; const current = detail.financial || {}; const isAdd = creditButton.hasAttribute('data-credit-add'); const amount = window.prompt(`${isAdd ? '增加' : '减少'}授信额度（分）：`, '100000'); if (amount === null) return; const value = Number(amount); if (!Number.isInteger(value) || value <= 0) { setMessage('merchantCreditMessage', '请输入正整数金额（单位：分）', true); return; } try { await api(`/api/v1/admin/platform-merchants/${encodeURIComponent(detail.id)}/credit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: isAdd ? value : -value, note: isAdd ? '后台增加码商授信额度' : '后台减少码商授信额度' }) }); setMessage('merchantCreditMessage', `${isAdd ? '增加' : '减少'}授信额度成功`, false); await loadData(); await openPlatformMerchantDetail(detail.id); } catch (error) { showError(error, 'merchantCreditMessage'); } return; }
  const settlementDifferenceButton = event.target.closest('[data-settlement-difference]');
  if (settlementDifferenceButton) { try { const result = (await api(`/api/v1/admin/settlements/${encodeURIComponent(settlementDifferenceButton.dataset.settlementDifference)}/difference`)).data; const diff = result.difference || {}; const matched = result.status === 'MATCHED'; setMessage('statementMessage', `${matched ? '结算单已匹配' : '发现结算差异'}：交易额 ${diff.grossAmount || 0} 分，退款 ${diff.refundAmount || 0} 分，手续费 ${diff.feeAmount || 0} 分，净结算 ${diff.netAmount || 0} 分`, !matched); } catch (error) { showError(error, 'statementMessage'); } return; }
  const settlementButton = event.target.closest('[data-settlement-id]');
  if (settlementButton) { try { await api(`/api/v1/admin/settlements/${encodeURIComponent(settlementButton.dataset.settlementId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: settlementButton.dataset.nextSettlementStatus }) }); await loadData(); } catch (error) { showError(error, 'statementMessage'); } return; }
  if (event.target.closest('[data-close-route-preview]')) { closeRoutePreviewModal(); return; }
  if (event.target.closest('#openRoutePreviewButton')) { openRoutePreviewModal(); return; }
  if (event.target.closest('[data-close-route-rule-edit]')) { closeRouteRuleEditModal(); return; }
  if (event.target.closest('#addRouteRuleButton')) { openRouteRuleEditModal(); return; }
  const routeEditButton = event.target.closest('[data-rule-edit]');
  if (routeEditButton) {
    const rule = state.rules.find((item) => String(item.id) === String(routeEditButton.dataset.ruleEdit));
    if (rule) openRouteRuleEditModal(rule);
    return;
  }
  const routeVersionsButton = event.target.closest('[data-route-versions]');
  if (routeVersionsButton) { try { await openRouteRuleVersions(routeVersionsButton.dataset.routeVersions); } catch (error) { showError(error, 'routeRuleMessage'); } return; }
  if (event.target.closest('[data-close-route-versions]')) { document.querySelector('#routeRuleVersionsModal')?.classList.add('hidden'); return; }
  const routeRollbackButton = event.target.closest('[data-route-rollback]');
  if (routeRollbackButton) { if (!window.confirm(`确认回滚到 v${routeRollbackButton.dataset.routeVersion} 吗？`)) return; try { await api(`/api/v1/admin/routing-rules/${encodeURIComponent(routeRollbackButton.dataset.routeRollback)}/versions/${encodeURIComponent(routeRollbackButton.dataset.routeVersion)}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); document.querySelector('#routeRuleVersionsModal')?.classList.add('hidden'); await loadData(); setMessage('routeRuleMessage', '路由规则已回滚并生成新版本', false); } catch (error) { showError(error, 'routeRuleMessage'); } return; }
  const ruleButton = event.target.closest('[data-rule-id]');
  if (ruleButton) { try { await api(`/api/v1/admin/routing-rules/${encodeURIComponent(ruleButton.dataset.ruleId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: ruleButton.dataset.nextStatus }) }); await loadData(); } catch (error) { showError(error, 'routeRuleMessage'); } return; }
  const adminButton = event.target.closest('[data-admin-id]');
  if (adminButton) { try { await api(`/api/v1/admin/users/${encodeURIComponent(adminButton.dataset.adminId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: adminButton.dataset.nextStatus }) }); await loadData(); } catch (error) { showError(error, 'adminUserMessage'); } return; }
  const qrPause = event.target.closest('[data-qr-pause]');
  if (qrPause) { try { await api(`/api/v1/admin/qr-codes/${encodeURIComponent(qrPause.dataset.qrPause)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: qrPause.dataset.nextQrStatus }) }); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } return; }
  const qrTest = event.target.closest('[data-qr-test]');
  if (qrTest) { try { const result = await api(`/api/v1/admin/qr-codes/${encodeURIComponent(qrTest.dataset.qrTest)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const popup = window.open('', '_blank', 'width=420,height=520'); if (popup) { popup.document.write(`<title>收款码测试</title><main style="font-family:Arial,sans-serif;text-align:center;padding:24px"><h3>${esc(result.data?.name || '收款码')}</h3><img alt="收款码" style="width:320px;height:320px" src="${result.data?.qrDataUrl || ''}"><p>请用微信扫码确认可正常识别</p></main>`); popup.document.close(); } setMessage('qrCodeMessage', '收款码测试二维码已生成', false); } catch (error) { showError(error, 'qrCodeMessage'); } return; }
  const qrDelete = event.target.closest('[data-qr-delete]');
  if (qrDelete) { if (!window.confirm('确认删除这条收款码吗？')) return; const operationPassword = window.prompt('请输入操作密码以删除收款码：') || ''; try { await api(`/api/v1/admin/qr-codes/${encodeURIComponent(qrDelete.dataset.qrDelete)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationPassword }) }); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } return; }
  const qrToggle = event.target.closest('[data-qr-channel-toggle]');
  if (qrToggle) { try { await api(`/api/v1/admin/channels/${encodeURIComponent(qrToggle.dataset.qrChannelToggle)}/qr-config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: Number(qrToggle.dataset.nextQrEnabled) === 1 }) }); await loadData(); } catch (error) { showError(error, 'qrChannelMessage'); } return; }
  const qrSave = event.target.closest('[data-qr-channel-save]');
  if (qrSave) { const row = qrSave.closest('tr'); const setting = state.qrChannelSettings.find((x) => String(x.channelId) === String(qrSave.dataset.qrChannelSave)); try { await api(`/api/v1/admin/channels/${encodeURIComponent(qrSave.dataset.qrChannelSave)}/qr-config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeWeight: Number(row?.querySelector('[data-qr-channel-weight]')?.value || setting?.routeWeight || 100), dailyAmountLimit: Number(setting?.dailyAmountLimit || 0), dailyOrderLimit: Number(setting?.dailyOrderLimit || 0), orderWindowSeconds: Number(setting?.orderWindowSeconds || 0), orderWindowLimit: Number(setting?.orderWindowLimit || 0) }) }); setMessage('qrChannelMessage', '挂码通道配置已保存', false); await loadData(); } catch (error) { showError(error, 'qrChannelMessage'); } return; }
  const actionButton = event.target.closest('[data-action]'); if (!actionButton) return;
  const id = actionButton.dataset.orderId; const action = actionButton.dataset.action;
  try {
    if (action === 'refund') { switchView('refunds'); document.querySelector('#refundOrderSelect').value = id; return; }
    if (action === 'close' && !window.confirm('确认关闭该订单吗？请先确认微信侧未支付成功。')) return;
    await api(`/api/v1/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await loadData();
  } catch (error) { showError(error); }
});

function switchView(view, syncPlatformNav = true) {
  if (!titles[view]) return;
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('hidden', item.id !== `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view && !item.classList.contains('nav-parent')));
  document.querySelectorAll('.nav-subitem').forEach((item) => item.classList.toggle('active', item.dataset.platformTabTarget ? (view === 'platform-merchants' && item.dataset.platformTabTarget === activePlatformTab) : item.dataset.view === view));
  if (syncPlatformNav) document.querySelector('[data-nav-group="platform-merchants"]')?.classList.toggle('open', view === 'platform-merchants');
  if (syncPlatformNav) { const nativeViews = ['subjects', 'apps', 'merchants']; document.querySelector('[data-nav-group="wechat-native"]')?.classList.toggle('open', nativeViews.includes(view)); document.querySelector('[data-nav-group="wechat-native"] .nav-parent')?.classList.toggle('active', nativeViews.includes(view)); const qrViews = ['qr-codes', 'qr-routing', 'qr-monitoring', 'qr-risk']; document.querySelector('[data-nav-group="qr-mode"]')?.classList.toggle('open', qrViews.includes(view)); document.querySelector('[data-nav-group="qr-mode"] .nav-parent')?.classList.toggle('active', qrViews.includes(view)); }
  if (syncPlatformNav) document.querySelector('[data-nav-group="orders"]')?.classList.toggle('open', ['orders', 'callbacks', 'exceptions', 'member-blocks', 'complaints'].includes(view));
  if (view === 'platform-merchants') setPlatformMerchantTab(activePlatformTab);
  setText('pageTitle', titles[view][0]); setText('pageSubtitle', titles[view][1]);
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#sidebarOverlay').classList.remove('open');
}
function setText(id, value) { const node = document.querySelector(`#${id}`); if (node) node.textContent = value ?? 0; }
function setMessage(id, value, error) { const node = document.querySelector(`#${id}`); if (!node) return; node.textContent = value; node.className = `message ${error ? 'error' : 'success'}`; }
function showError(error, target = 'formMessage') {
  const code = error?.message || String(error);
  const messages = {
    DATA_ENCRYPTION_KEY_REQUIRED: '服务端未配置 DATA_ENCRYPTION_KEY，请设置至少 32 位的数据加密主密钥后重启后台，再保存商户号。',
    DATA_ENCRYPTION_KEY_REQUIRED_FOR_APP_SECRET: '服务端未配置 DATA_ENCRYPTION_KEY，请先设置至少 32 位的数据加密主密钥后重启后台。',
    MERCHANT_JSAPI_APP_REQUIRED: '所选商户未配置已启用的公众号支付能力，请先在商户号管理配置公众号 AppID。',
    MERCHANT_NATIVE_APP_REQUIRED: '所选商户未配置已启用的 Native 支付能力，请先在商户号管理配置 Native AppID。',
    WECHAT_JSAPI_MERCHANT_NOT_READY: '公众号支付通道尚未配置可用的商户号或公众号 AppID。'
  };
  setMessage(target, messages[code] || code, true);
}
function money(value) { return (Number(value || 0) / 100).toFixed(2); }
function date(value) { return value ? new Date(value).toLocaleString() : '-'; }
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-'; }
const STATUS_LABELS = { SUCCESS: '支付成功', FAILED: '支付失败', CLOSED: '已关闭', UNKNOWN: '状态未知', ACTIVE: '正常', FROZEN: '冻结', PENDING: '待审核', SUSPENDED: '暂停', PAUSED: '已暂停', DISABLED: '已停用', READY: '预检通过', NOT_READY: '预检未通过', OPEN: '熔断中', DEAD: '死信', ABNORMAL: '异常', PENDING: '待处理', PROCESSING: '处理中', DRAFT: '待确认', CONFIRMED: '已确认', PAID: '已打款', VOID: '已作废', CREATED: '创建中', ROUTED: '已路由', QR_CREATED: '待扫码', PAYING: '支付中', MATCHED: '已匹配', MATCHED_LOCAL: '本地成功', PENDING_QUERY: '待查单', LOCAL_ONLY: '本地独有', EXTERNAL_ONLY: '外部独有', AMOUNT_MISMATCH: '金额差异', STATUS_MISMATCH: '状态差异', REFUND_MISMATCH: '退款差异', LOCAL_EXCEPTION: '本地异常', MISSING: '未绑定', VERIFIED: '已验证', CHANNEL_DISABLED: '通道已停用', APP_DISABLED: 'AppID 已停用', CALLBACK_PATH_INVALID: '回调路径无效', WECHAT_MERCHANT_NOT_READY: '微信商户号未就绪', CODE_MERCHANT_ROUTE_NOT_READY: '码商路由未就绪', HIGH: '高', MEDIUM: '中', NORMAL: '普通', LEGACY_SNAPSHOT: '历史状态', STATUS_CHANGE: '状态变更', ORDER_CREATE: '创建订单', BATCH_QUERY: '批量查单', QUERY: '查单', QUERY_FAILED: '查单失败', BATCH_QUERY_FAILED: '批量查单失败', EXCEPTION_QUERY: '异常查单', CLOSE: '关单', MARK_UNKNOWN: '标记未知', RETRY_CALLBACK: '重试回调', MANUAL_SUPPLEMENT: '人工补单', ORDER_CALLBACK_RETRY: '订单回调重试', ORDER_MANUAL_SUPPLEMENT: '订单人工补单', CREATE: '创建', UPDATE: '更新', STATUS: '状态变更', ROLLBACK: '回滚', MIGRATION: '迁移', INDIVIDUAL_BUSINESS: '个体工商户', ENTERPRISE: '企业', SERVICE_ACCOUNT: '服务号', SUBSCRIPTION_ACCOUNT: '订阅号', MINI_PROGRAM: '小程序', OWNER: '负责人', OPERATOR: '运营', FINANCE: '财务', VIEWER: '只读', TRANSACTION: '支付回调', REFUND: '退款回调', REFUND_SUCCESS: '退款成功', REFUND_FAILED: '退款失败' };
function labelOf(value) { const text = String(value ?? ''); return STATUS_LABELS[text] || text; }
function priorityTag(value) { const cls = value === '高' ? 'failed' : value === '中' ? 'paused' : 'ok'; return `<span class="status ${cls}">${esc(value)}</span>`; }
function statusTag(value) { const normalized = String(value ?? ''); const cls = ['SUCCESS', 'ACTIVE', 'CLOSED', 'READY', 'MATCHED', 'MATCHED_LOCAL', 'PAID', 'NORMAL'].includes(normalized) ? 'ok' : ['FAILED', 'ABNORMAL', 'OPEN', 'DEAD', 'NOT_READY', 'LOCAL_ONLY', 'EXTERNAL_ONLY', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'REFUND_MISMATCH', 'LOCAL_EXCEPTION', 'QUERY_FAILED', 'BATCH_QUERY_FAILED', 'HIGH'].includes(normalized) ? 'failed' : 'paused'; return `<span class="status ${cls}">${esc(labelOf(normalized))}</span>`; }
function reconStatusTag(value) { const ok = ['MATCHED', 'MATCHED_LOCAL'].includes(value); const label = { MATCHED: '已匹配', MATCHED_LOCAL: '本地成功', PENDING_QUERY: '待查单', LOCAL_ONLY: '本地独有', EXTERNAL_ONLY: '外部独有', AMOUNT_MISMATCH: '金额差异', STATUS_MISMATCH: '状态差异', REFUND_MISMATCH: '退款差异', LOCAL_EXCEPTION: '本地异常' }[value] || value; const cls = ok ? 'ok' : ['LOCAL_ONLY', 'EXTERNAL_ONLY', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'REFUND_MISMATCH', 'LOCAL_EXCEPTION'].includes(value) ? 'failed' : 'paused'; return `<span class="status ${cls}">${esc(label)}</span>`; }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

['clientMerchantSearch', 'clientMerchantStatusFilter'].forEach((id) => { const node = document.querySelector('#' + id); node?.addEventListener('input', render); node?.addEventListener('change', render); });
document.querySelector('#refreshClientMerchantsButton')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'clientMerchantMessage')));
document.querySelector('#resetClientMerchantFilters')?.addEventListener('click', () => { document.querySelector('#clientMerchantSearch').value = ''; document.querySelector('#clientMerchantStatusFilter').value = ''; render(); });
['platformMerchantSearch', 'platformMerchantStatusFilter', 'platformMerchantHealthFilter'].forEach((id) => { const node = document.querySelector(`#${id}`); node?.addEventListener('input', render); node?.addEventListener('change', render); });
['subjectSearch', 'subjectTypeFilter', 'appSearch', 'appSubjectFilter', 'appStatusFilter', 'merchantSearch', 'merchantSubjectFilter', 'merchantStatusFilter'].forEach((id) => { const node = document.querySelector(`#${id}`); node?.addEventListener('input', render); node?.addEventListener('change', render); });
['qrCodeSearch', 'qrCodeStatusFilter'].forEach((id) => { const node = document.querySelector(`#${id}`); node?.addEventListener('input', render); node?.addEventListener('change', render); });
document.querySelector('#qrCodeRefreshButton')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'qrCodeMessage')));
document.querySelector('#qrChannelRefreshButton')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'qrChannelMessage')));
document.querySelector('#qrMonitoringRefreshButton')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'qrMonitoringMessage')));
document.querySelector('#publicPaymentMonitorRefresh')?.addEventListener('click', () => loadData().catch((error) => showError(error, 'ppmMessage')));
document.querySelector('#publicPaymentMonitorHours')?.addEventListener('change', () => loadData().catch((error) => showError(error, 'ppmMessage')));
document.querySelector('#qrOrderRecoveryButton')?.addEventListener('click', async () => { try { const result = await api('/api/v1/admin/qr-orders/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('qrMonitoringMessage', `查单完成：扫描 ${result.data?.scanned || 0} 笔，更新 ${result.data?.updated || 0} 笔，关单 ${result.data?.closed || 0} 笔，失败 ${result.data?.failed || 0} 笔`, false); await loadData(); } catch (error) { showError(error, 'qrMonitoringMessage'); } });
document.querySelector('#qrMonitoringRunButton')?.addEventListener('click', async () => { try { const result = await api('/api/v1/admin/qr-monitoring/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('qrMonitoringMessage', `检查完成：${result.data?.checked || 0} 条，自动暂停 ${result.data?.paused || 0} 条，异常 ${result.data?.alerts || 0} 条`, false); await loadData(); } catch (error) { showError(error, 'qrMonitoringMessage'); } });
document.querySelector('#qrCodeExportButton')?.addEventListener('click', () => { window.location.href = '/api/v1/admin/qr-codes/export'; });
document.querySelector('#qrBatchStatusButton')?.addEventListener('click', async () => { const ids = [...document.querySelectorAll('[data-qr-select]:checked')].map((node) => node.dataset.qrSelect); const status = document.querySelector('#qrBatchStatusSelect')?.value || ''; if (!ids.length || !status) { setMessage('qrCodeMessage', '请选择收款码和批量状态。', true); return; } const operationPassword = window.prompt('请输入操作密码以执行批量状态变更：') || ''; try { await api('/api/v1/admin/qr-codes/batch-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, status, operationPassword }) }); setMessage('qrCodeMessage', `已更新 ${ids.length} 条收款码状态`, false); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } });
document.querySelector('#qrSettlementQueryButton')?.addEventListener('click', async () => { const from = document.querySelector('#qrSettlementFrom')?.value; const to = document.querySelector('#qrSettlementTo')?.value; if (!from || !to) { setMessage('qrSettlementMessage', '请选择对账日期。', true); return; } const end = from === to ? (() => { const d = new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })() : to; try { const result = await api(`/api/v1/admin/qr-settlement?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(end)}`); state.qrSettlement = { data: result.data || [], summary: result.summary || {} }; renderQrViews(); setMessage('qrSettlementMessage', `已加载 ${result.data?.length || 0} 条收款码对账记录`, false); } catch (error) { showError(error, 'qrSettlementMessage'); } });
function parseQrImport(raw) { return String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const parts = line.split('|').map((part) => part.trim()); return parts.length > 1 ? { name: parts[0], payload: parts[1], channelId: parts[2] || null, ownerId: parts[3] || null } : { payload: parts[0] }; }); }
function openQrImportModal() { const form = document.querySelector('#qrImportForm'); if (!form) return; form.reset(); setMessage('qrImportPreview', '填写后先点击“校验预览”，系统会标出重复和无效内容。', false); document.querySelector('#qrImportModal')?.classList.remove('hidden'); }
async function validateQrImport() { const raw = document.querySelector('#qrImportForm [name="raw"]')?.value || ''; const baseChannel = document.querySelector('#qrImportForm [name="channelId"]')?.value || null; const baseOwner = document.querySelector('#qrImportForm [name="ownerId"]')?.value || null; const items = parseQrImport(raw).map((item) => ({ ...item, channelId: item.channelId || baseChannel, ownerId: item.ownerId || baseOwner })); if (!items.length) { setMessage('qrImportPreview', '请先粘贴收款码内容。', true); return null; } try { const result = await api('/api/v1/admin/qr-codes/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); const skipped = result.data?.skipped || []; setMessage('qrImportPreview', `共 ${items.length} 条，可导入 ${result.data?.valid?.length || 0} 条，跳过 ${skipped.length} 条${skipped.length ? `：${skipped.slice(0, 3).map((x) => `${x.name}（${x.reason}）`).join('、')}` : ''}`, skipped.length > 0 && !result.data?.valid?.length); return result.data?.valid || []; } catch (error) { showError(error, 'qrImportPreview'); return null; } }
async function importQrCodes() { const valid = await validateQrImport(); if (!valid?.length) return; try { const result = await api('/api/v1/admin/qr-codes/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: valid }) }); document.querySelector('#qrImportModal')?.classList.add('hidden'); setMessage('qrCodeMessage', `已导入 ${result.data?.length || 0} 条，跳过 ${result.skipped?.length || 0} 条`, false); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } }
document.querySelector('#qrCodeBatchButton')?.addEventListener('click', openQrImportModal);
document.querySelector('#qrCodeAddButton')?.addEventListener('click', openQrImportModal);
document.querySelector('#qrImportValidateButton')?.addEventListener('click', validateQrImport);
document.querySelectorAll('[data-close-qr-import]').forEach((node) => node.addEventListener('click', () => document.querySelector('#qrImportModal')?.classList.add('hidden')));
document.querySelector('#qrImportForm')?.addEventListener('submit', (event) => { event.preventDefault(); void importQrCodes(); });
document.querySelector('#merchantPaymentTestForm')?.addEventListener('submit', (event) => { event.preventDefault(); void createMerchantPaymentTest(); });
document.querySelector('#qrSelectAll')?.addEventListener('change', (event) => { document.querySelectorAll('[data-qr-select]').forEach((node) => { node.checked = event.target.checked; }); });
document.querySelector('#qrBatchAssignButton')?.addEventListener('click', async () => { const ids = [...document.querySelectorAll('[data-qr-select]:checked')].map((node) => node.dataset.qrSelect); const channelId = document.querySelector('#qrBatchChannelSelect')?.value || null; if (!ids.length) { setMessage('qrCodeMessage', '请先选择收款码。', true); return; } if (!channelId) { setMessage('qrCodeMessage', '请选择要分配的支付通道。', true); return; } try { await api('/api/v1/admin/qr-codes/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, channelId }) }); setMessage('qrCodeMessage', `已将 ${ids.length} 条收款码分配到通道 ${channelId}`, false); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } });
const qrImageButton = document.createElement('button'); qrImageButton.type = 'button'; qrImageButton.className = 'ghost-button'; qrImageButton.textContent = '批量导入图片'; document.querySelector('#qrCodeBatchButton')?.parentElement?.appendChild(qrImageButton);
qrImageButton.addEventListener('click', async () => {
  if (!('BarcodeDetector' in window)) { setMessage('qrCodeMessage', '当前浏览器不支持图片二维码识别，请复制收款码内容后使用批量粘贴导入', true); return; }
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.click();
  input.addEventListener('change', async () => { const detector = new window.BarcodeDetector({ formats: ['qr_code'] }); const items = []; for (const file of Array.from(input.files || [])) { try { const values = await detector.detect(await createImageBitmap(file)); const payload = values[0]?.rawValue; if (payload) items.push({ name: file.name.replace(/\.[^.]+$/, ''), payload }); } catch { /* skip unreadable image */ } } if (!items.length) { setMessage('qrCodeMessage', '没有识别到有效二维码，请检查图片清晰度', true); return; } try { const check = await api('/api/v1/admin/qr-codes/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); const valid = check.data?.valid || []; if (!valid.length) { setMessage('qrCodeMessage', '图片识别完成，但全部是重复或无效收款码', true); return; } const result = await api('/api/v1/admin/qr-codes/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: valid }) }); setMessage('qrCodeMessage', `图片识别并导入 ${result.data?.length || 0} 条，跳过 ${check.data?.skipped?.length || 0} 条`, false); await loadData(); } catch (error) { showError(error, 'qrCodeMessage'); } });
});
document.querySelector('#qrRiskSaveButton')?.addEventListener('click', async () => {
  const payload = { orderWindowSeconds: Number(document.querySelector('#qrRiskWindowSeconds')?.value || 0), orderWindowLimit: Number(document.querySelector('#qrRiskWindowLimit')?.value || 0), dailyOrderLimit: Number(document.querySelector('#qrRiskDailyOrders')?.value || 0), dailyAmountLimit: Number(document.querySelector('#qrRiskDailyAmount')?.value || 0), failureRateThreshold: Number(document.querySelector('#qrRiskFailureRate')?.value || 0), minOrdersForCheck: Number(document.querySelector('#qrRiskMinOrders')?.value || 5), timeoutMinutes: Number(document.querySelector('#qrRiskTimeoutMinutes')?.value || 15), autoPauseEnabled: Number(document.querySelector('#qrRiskAutoPause')?.value || 0) === 1 };
  try { await Promise.all(state.qrChannelSettings.filter((item) => Number(item.enabled) === 1).map((item) => api(`/api/v1/admin/channels/${encodeURIComponent(item.channelId)}/qr-config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))); setMessage('qrRiskMessage', '已将默认风控规则应用到当前启用挂码的支付通道', false); await loadData(); } catch (error) { showError(error, 'qrRiskMessage'); }
});
document.querySelector('#resetPlatformMerchantFilters')?.addEventListener('click', () => { document.querySelector('#platformMerchantSearch').value = ''; document.querySelector('#platformMerchantStatusFilter').value = ''; document.querySelector('#platformMerchantHealthFilter').value = ''; render(); });
document.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-platform-tab]');
  if (tab) { setPlatformMerchantTab(tab.dataset.platformTab || 'list'); return; }
  if (event.target.closest('#platformMerchantSearchButton')) { render(); return; }
  if (event.target.closest('#platformLedgerSearch') || event.target.closest('#platformPrepaidSearch')) { await loadPlatformMerchantFinance(); return; }
  if (event.target.closest('#platformLedgerReset')) { ['platformLedgerMerchantFilter', 'platformLedgerTypeFilter', 'platformLedgerNoteFilter', 'platformLedgerDateFrom', 'platformLedgerDateTo'].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.value = ''; }); await loadPlatformMerchantFinance(); return; }
  if (event.target.closest('#platformPrepaidReset')) { ['platformPrepaidMerchantFilter', 'platformPrepaidTypeFilter', 'platformPrepaidDateFrom', 'platformPrepaidDateTo'].forEach((id) => { const node = document.querySelector(`#${id}`); if (node) node.value = ''; }); await loadPlatformMerchantFinance(); return; }
  const exportButton = event.target.closest('#platformLedgerExport, #platformPrepaidExport');
  if (exportButton) {
    const isLedger = exportButton.id === 'platformLedgerExport';
    const rows = isLedger ? state.platformMerchantLedger : state.platformMerchantPrepaid;
    const header = isLedger ? ['码商ID', '码商名称', '变更前余额', '变更金额', '变更后余额', '变更类型', '通道名称', '业务订单号', '备注', '创建时间'] : ['码商ID', '码商名称', '变更前预付', '变更金额', '变更后预付', '变更类型', '汇率', '转账凭证', '操作人', '创建时间'];
    const body = rows.map((item) => isLedger ? [item.merchantCode || item.merchantId, item.merchantName, item.balanceBefore, item.amount, item.balanceAfter, ledgerType(item.entryType), item.channelName || '', item.businessOrderNo || item.referenceId || '', item.note || '', item.createdAt] : [item.merchantCode || item.merchantId, item.merchantName, item.prepaidBefore, item.amount, item.prepaidAfter, item.entryType, item.exchangeRate || 1, item.transferProof || '', item.operator || '', item.createdAt]);
    const csv = [header, ...body].map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })); link.download = isLedger ? '码商资金流水.csv' : '码商预付记录.csv'; link.click(); URL.revokeObjectURL(link.href); return;
  }
});
document.addEventListener('change', (event) => { if (event.target?.id === 'platformMerchantShowDisabled') render(); });
document.querySelector('#resetSubjectFilters')?.addEventListener('click', () => { document.querySelector('#subjectSearch').value = ''; document.querySelector('#subjectTypeFilter').value = ''; render(); });
document.querySelector('#resetAppFilters')?.addEventListener('click', () => { document.querySelector('#appSearch').value = ''; document.querySelector('#appSubjectFilter').value = ''; document.querySelector('#appStatusFilter').value = ''; render(); });
document.querySelector('#resetMerchantFilters')?.addEventListener('click', () => { document.querySelector('#merchantSearch').value = ''; document.querySelector('#merchantSubjectFilter').value = ''; document.querySelector('#merchantStatusFilter').value = ''; render(); });
document.querySelector('#qrCodeFilterReset')?.addEventListener('click', () => { document.querySelector('#qrCodeSearch').value = ''; document.querySelector('#qrCodeStatusFilter').value = ''; render(); });
document.querySelector('#botSaveButton')?.addEventListener('click', async () => {
  const value = (id) => document.querySelector('#' + id)?.value || '';
  try { await api('/api/v1/admin/bot/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: document.querySelector('#botEnabled').checked, botToken: value('botToken'), webhookUrl: value('botWebhookUrl'), adminGroupId: value('botAdminGroupId'), reportEnabled: document.querySelector('#botReportEnabled').checked, reportTime: value('botReportTime'), notificationSettings: { channelCircuit: document.querySelector('#botNotifyChannelCircuit').checked, channelFailure: document.querySelector('#botNotifyChannelFailure').checked, callbackFailure: document.querySelector('#botNotifyCallbackFailure').checked, lowBalance: document.querySelector('#botNotifyLowBalance').checked, complaint: document.querySelector('#botNotifyComplaint').checked }, thresholds: { channelFailureCount: Number(value('botFailureThreshold') || 0), callbackFailureCount: Number(value('botCallbackThreshold') || 0), lowBalanceAmount: Number(value('botLowBalanceThreshold') || 0) } }) }); document.querySelector('#botToken').value = ''; setMessage('botMessage', 'BOT 配置已保存', false); await loadData(); } catch (error) { showError(error, 'botMessage'); }
});
document.querySelector('#botTestButton')?.addEventListener('click', async () => { try { await api('/api/v1/admin/bot/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('botMessage', '测试消息已发送', false); await loadData(); } catch (error) { showError(error, 'botMessage'); } });
document.querySelector('#botWebhookButton')?.addEventListener('click', async () => { try { const result = await api('/api/v1/admin/bot/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setMessage('botMessage', `Webhook 已设置：${result.data?.url || ''}`, false); } catch (error) { showError(error, 'botMessage'); } });
document.querySelector('#botGroupForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api('/api/v1/admin/bot/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); setMessage('botMessage', '接收群组已添加', false); await loadData(); } catch (error) { showError(error, 'botMessage'); } });
document.querySelector('#botOperatorForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api('/api/v1/admin/bot/operators', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); setMessage('botMessage', '操作员已添加', false); await loadData(); } catch (error) { showError(error, 'botMessage'); } });
document.addEventListener('click', async (event) => { const toggle = event.target.closest('[data-bot-group-toggle]'); const remove = event.target.closest('[data-bot-group-delete]'); if (!toggle && !remove) return; try { const group = (state.bot.groups || []).find((item) => String(item.id) === String((toggle || remove).dataset.botGroupToggle || (toggle || remove).dataset.botGroupDelete)); if (remove) { await api(`/api/v1/admin/bot/groups/${encodeURIComponent(remove.dataset.botGroupDelete)}`, { method: 'DELETE' }); } else if (group) { await api(`/api/v1/admin/bot/groups/${encodeURIComponent(group.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: group.name, chatId: group.chatId, scopeType: group.scopeType, scopeId: group.scopeId || undefined, enabled: toggle.dataset.nextEnabled === 'true' }) }); } await loadData(); } catch (error) { showError(error, 'botMessage'); } });
document.addEventListener('click', async (event) => { const remove = event.target.closest('[data-bot-operator-delete]'); if (!remove) return; try { await api('/api/v1/admin/bot/operators', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: remove.dataset.botOperatorDelete, userId: remove.dataset.botOperatorUser }) }); await loadData(); } catch (error) { showError(error, 'botMessage'); } });
document.addEventListener('submit', async (event) => {
  if (event.target?.id !== 'clientMerchantForm') return;
  event.preventDefault();
  const form=event.target; const raw=Object.fromEntries(new FormData(form).entries());
  const payload={ id: form.dataset.editingId || undefined, code: form.dataset.editingId ? raw.code : undefined, name: raw.name, loginUsername: raw.loginUsername, password: raw.password || undefined, agentName: raw.agentName || undefined, groupId: raw.groupIdText || '0', groupName: raw.groupName || undefined, loginIpAllowlist: raw.loginIpAllowlist || '', withdrawIpAllowlist: raw.withdrawIpAllowlist || '', balanceWarningAmount: Number(raw.balanceWarningAmount || 0), singleOrderLimit: Number(raw.singleOrderLimit || 0), dailyAmountLimit: Number(raw.dailyAmountLimit || 0), settlementRate: Number(raw.settlementRate || 0), profitShare: Number(raw.profitShare || 0), withdrawalFee: Number(raw.withdrawalFee || 0) };
  try { const id=form.dataset.editingId; const result = await api(id ? '/api/v1/admin/client-merchants/' + encodeURIComponent(id) : '/api/v1/admin/client-merchants', { method:id ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); const apiKey = result.data?.apiKey; if (apiKey && result.data?.id) state.clientApiKeys[String(result.data.id)] = apiKey; setMessage('clientMerchantFormMessage', id ? '商户资料已更新' : apiKey ? `商户已创建，客户端 API Key：${apiKey}（仅显示本次，请立即保存）` : '商户已创建', false); await loadData(); if (apiKey) { form.closest('.modal-backdrop').classList.remove('hidden'); return; } form.closest('.modal-backdrop').classList.add('hidden'); } catch (error) { showError(error, 'clientMerchantFormMessage'); }
});

document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closePlatformMerchantModal(); closePlatformMerchantAdjustModal(); closePlatformMerchantChannelsModal(); closeChannelModal(); closeChannelRiskModal(); closeChannelMerchantAuthModal(); closeSubjectModal(); closeAppModal(); closeMerchantModal(); closeMerchantBatchRiskModal(); closeOrderSupplementModal(); closeMemberBlockModal(); document.querySelector('#wechatMerchantStatsModal')?.classList.add('hidden'); } });
document.addEventListener('click', (event) => { if (!event.target.closest('.more-menu')) document.querySelectorAll('.more-menu.open').forEach((node) => { node.classList.remove('open'); resetFloatingMenu(node.querySelector('.more-menu-list')); }); });

setReconciliationDefaults();
initializeDashboardRange();
normalizeMerchantPaymentSelector();
loadSession().then((ok) => { if (ok) return loadData(); }).catch((error) => showError(error));
// 商户号监控状态由后端在真实微信接口调用时即时更新；页面每 30 秒拉取一次最新锁定状态。
window.setInterval(() => { void refreshMerchantMonitorState(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshMerchantMonitorState(); });



