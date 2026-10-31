import { useEffect, useState } from 'react';
import { toast } from '../../store/uiStore.js';
import { usePaginated } from '../../hooks/usePaginated.js';
import {
  approveRegistration,
  createUser,
  listClasses,
  listPendingRegistrations,
  listUsers,
  rejectRegistration,
  resetUserPassword,
  updateUser,
  updateUserRole,
  updateUserStatus,
} from '../../api/users.js';
import PageHeader from '../../components/PageHeader.jsx';
import Table from '../../components/Table.jsx';
import Pagination from '../../components/Pagination.jsx';
import Tag from '../../components/Tag.jsx';
import Button from '../../components/Button.jsx';
import Modal from '../../components/Modal.jsx';
import { FormField, Input, Select, Textarea } from '../../components/Form.jsx';
import { formatDateTime } from '../../utils/format.js';
import {
  ROLE_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_TAG,
  tagClass,
} from '../../utils/enums.js';
import { email as emailRule, maxLen, required, runRules, username as usernameRule } from '../../utils/validate.js';

const EMPTY_FORM = {
  username: '',
  realName: '',
  roleCode: 'student',
  email: '',
  phone: '',
  classId: '',
  department: '',
  remark: '',
};

/** 账号管理 + 注册审批（REQ-UAM-05/06/08/09） */
export default function AdminUsers() {
  const [tab, setTab] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [status, setStatus] = useState('');
  const [classes, setClasses] = useState([]);

  const all = usePaginated(listUsers, {
    initialFilters: { keyword: '', roleCode: '', status: '' },
    pageSize: 20,
  });
  const pending = usePaginated(listPendingRegistrations, { pageSize: 20 });

  const [modal, setModal] = useState(null); // { type, user }
  const [form, setForm] = useState(EMPTY_FORM);
  const [errs, setErrs] = useState({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [credential, setCredential] = useState(null); // { title, value }

  useEffect(() => {
    listClasses()
      .then((list) => setClasses(Array.isArray(list) ? list : []))
      .catch(() => setClasses([]));
  }, []);

  const openModal = (type, user = null) => {
    setModal({ type, user });
    setErrs({});
    setReason('');
    if (type === 'create') setForm(EMPTY_FORM);
    if (type === 'role') {
      // 调整角色弹窗需回填当前角色，否则会误显示为默认「学生」
      setForm({ ...EMPTY_FORM, roleCode: user?.roleCode || 'student', realName: user?.realName || '' });
    }
    if (type === 'edit') {
      setForm({
        username: user?.username || '',
        realName: user?.realName || '',
        roleCode: user?.roleCode || 'student',
        email: user?.email || '',
        phone: user?.phone || '',
        classId: user?.classId ?? '',
        department: user?.department || '',
        remark: user?.remark || '',
      });
    }
  };

  const closeModal = () => {
    setModal(null);
    setForm(EMPTY_FORM);
    setErrs({});
    setReason('');
  };

  const refresh = () => {
    all.reload();
    pending.reload();
  };

  const applyFilter = () => {
    all.setFilters({ keyword, roleCode, status });
  };

  const validateUserForm = () => {
    const rules = {
      realName: [(v) => required(v, '姓名'), (v) => maxLen(v, 64, '姓名')],
      email: [(v) => emailRule(v)],
      phone: [(v) => maxLen(v, 32, '手机号')],
      remark: [(v) => maxLen(v, 255, '备注')],
    };
    if (modal?.type === 'create') {
      rules.username = [(v) => usernameRule(v)];
      rules.classId = [(v, values) => (values.roleCode === 'student' ? required(v, '班级') : null)];
    }
    const result = runRules(form, rules);
    setErrs(result.errors);
    return result.valid;
  };

  const submitCreate = async () => {
    if (!validateUserForm()) return;
    setSubmitting(true);
    try {
      const result = await createUser({
        username: form.username.trim(),
        realName: form.realName.trim(),
        roleCode: form.roleCode,
        ...(form.email ? { email: form.email.trim() } : {}),
        ...(form.phone ? { phone: form.phone.trim() } : {}),
        ...(form.classId !== '' ? { classId: Number(form.classId) } : {}),
        ...(form.department ? { department: form.department } : {}),
        ...(form.remark ? { remark: form.remark } : {}),
      });
      closeModal();
      setCredential({
        title: '账号创建成功，初始密码仅展示一次',
        value: result?.initialPassword || '（服务端未返回初始密码，请使用重置密码功能）',
      });
      refresh();
    } catch (err) {
      if (err?.errors?.length) {
        const mapped = {};
        err.errors.forEach((e) => {
          if (e?.field) mapped[e.field] = e.message;
        });
        setErrs(mapped);
      }
      toast.error(err?.displayMessage || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!validateUserForm()) return;
    setSubmitting(true);
    try {
      await updateUser(modal.user.id, {
        realName: form.realName.trim(),
        ...(form.email ? { email: form.email.trim() } : {}),
        ...(form.phone ? { phone: form.phone.trim() } : {}),
        ...(form.classId !== '' ? { classId: Number(form.classId) } : {}),
        ...(form.department ? { department: form.department } : {}),
        ...(form.remark ? { remark: form.remark } : {}),
      });
      toast.success('用户资料已更新');
      closeModal();
      refresh();
    } catch (err) {
      toast.error(err?.displayMessage || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (user, nextStatus) => {
    setSubmitting(true);
    try {
      await updateUserStatus(user.id, {
        status: nextStatus,
        ...(reason ? { reason } : {}),
      });
      toast.success(nextStatus === 'disabled' ? '账号已禁用，历史数据保留' : '账号已启用');
      closeModal();
      refresh();
    } catch (err) {
      toast.error(err?.displayMessage || '状态更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const changeRole = async (user, nextRole) => {
    setSubmitting(true);
    try {
      await updateUserRole(user.id, { roleCode: nextRole });
      toast.success(`角色已调整为「${ROLE_LABEL[nextRole]}」，旧令牌已失效`);
      closeModal();
      refresh();
    } catch (err) {
      toast.error(err?.displayMessage || '角色调整失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doResetPassword = async (user) => {
    setSubmitting(true);
    try {
      const result = await resetUserPassword(user.id);
      closeModal();
      setCredential({
        title: `已重置 ${user.realName || user.username} 的密码`,
        value: result?.temporaryPassword || '（服务端未返回临时密码）',
      });
    } catch (err) {
      toast.error(err?.displayMessage || '重置失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doApprove = async (user) => {
    setSubmitting(true);
    try {
      await approveRegistration(user.id);
      toast.success('注册申请已通过，账号可正常登录');
      refresh();
    } catch (err) {
      toast.error(err?.displayMessage || '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doReject = async (user) => {
    if (!reason.trim()) {
      setErrs({ reason: '请填写驳回原因' });
      return;
    }
    setSubmitting(true);
    try {
      await rejectRegistration(user.id, reason.trim());
      toast.success('注册申请已驳回');
      closeModal();
      refresh();
    } catch (err) {
      toast.error(err?.displayMessage || '驳回失败');
    } finally {
      setSubmitting(false);
    }
  };

  const userColumns = [
    {
      key: 'user',
      title: '用户',
      render: (u) => (
        <div className="user-cell">
          <span className="avatar" aria-hidden="true">
            {(u.realName || u.username || 'U').slice(0, 1)}
          </span>
          <div>
            <div className="strong">{u.realName}</div>
            <div className="xs muted mono">{u.username}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'roleCode',
      title: '角色',
      render: (u) => <Tag tone={u.roleCode === 'admin' ? 'violet' : u.roleCode === 'teacher' ? 'cyan' : 'neutral'}>{ROLE_LABEL[u.roleCode] || u.roleCode}</Tag>,
    },
    {
      key: 'org',
      title: '班级 / 部门',
      render: (u) => <span className="small">{u.className || u.department || '—'}</span>,
    },
    {
      key: 'status',
      title: '状态',
      render: (u) => <Tag tone={tagClass(USER_STATUS_TAG, u.status).replace('tag-', '')}>{USER_STATUS_LABEL[u.status] || u.status}</Tag>,
    },
    {
      key: 'lastLoginAt',
      title: '最近登录',
      render: (u) => <span className="mono xs">{formatDateTime(u.lastLoginAt)}</span>,
    },
    {
      key: 'actions',
      title: '操作',
      render: (u) => (
        <div className="cell-actions">
          <Button size="sm" variant="ghost" onClick={() => openModal('edit', u)}>
            编辑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openModal('role', u)}>
            调整角色
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openModal('reset', u)}>
            重置密码
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openModal(u.status === 'disabled' ? 'enable' : 'disable', u)}
          >
            {u.status === 'disabled' ? '启用' : '禁用'}
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns = [
    {
      key: 'user',
      title: '申请学生',
      render: (u) => (
        <div>
          <div className="strong">{u.realName}</div>
          <div className="xs muted mono">{u.username}</div>
        </div>
      ),
    },
    { key: 'className', title: '班级', render: (u) => u.className || '—' },
    { key: 'email', title: '邮箱', render: (u) => u.email || '—' },
    {
      key: 'createdAt',
      title: '申请时间',
      render: (u) => <span className="mono xs">{formatDateTime(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      title: '审核',
      render: (u) => (
        <div className="cell-actions">
          <Button size="sm" variant="primary" loading={submitting} onClick={() => doApprove(u)}>
            通过
          </Button>
          <Button size="sm" variant="danger" onClick={() => openModal('reject', u)}>
            驳回
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="账号管理"
        desc="维护学生、教师与管理员账号，处理学生注册申请。禁用账号立即生效，但历史考试、答卷与成绩完整保留。"
        actions={
          <Button variant="primary" onClick={() => openModal('create')}>
            + 新建账号
          </Button>
        }
        meta={
          <>
            <Tag tone="cyan">全部账号 {all.total}</Tag>
            <Tag tone="amber">待审核 {pending.total}</Tag>
          </>
        }
      />

      <div className="row gap-2" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`btn ${tab === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('all')}
        >
          全部账号
        </button>
        <button
          type="button"
          className={`btn ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('pending')}
        >
          注册审批（{pending.total}）
        </button>
      </div>

      {tab === 'all' ? (
        <>
          <div className="toolbar">
            <div className="toolbar-item grow">
              <span>关键词</span>
              <Input
                placeholder="姓名 / 学号 / 工号 / 邮箱"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
              />
            </div>
            <div className="toolbar-item">
              <span>角色</span>
              <Select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
                <option value="">全部角色</option>
                <option value="admin">管理员</option>
                <option value="teacher">教师</option>
                <option value="student">学生</option>
              </Select>
            </div>
            <div className="toolbar-item">
              <span>状态</span>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="pending">待审核</option>
                <option value="disabled">已禁用</option>
                <option value="locked">已锁定</option>
              </Select>
            </div>
            <div className="toolbar-actions">
              <Button variant="primary" size="sm" onClick={applyFilter}>
                查询
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKeyword('');
                  setRoleCode('');
                  setStatus('');
                  all.resetFilters({ keyword: '', roleCode: '', status: '' });
                }}
              >
                重置
              </Button>
            </div>
          </div>

          <div className="list-card">
            <Table
              columns={userColumns}
              rows={all.list}
              loading={all.loading}
              error={all.error}
              onRetry={all.reload}
              emptyTitle="没有符合条件的账号"
              emptyDesc="请调整角色或状态筛选；若总数大于 0 而当前页为空，请回到第 1 页。"
            />
            <Pagination
              page={all.page}
              pageSize={all.pageSize}
              total={all.total}
              onChange={all.setPage}
              onPageSizeChange={all.setPageSize}
            />
          </div>
        </>
      ) : (
        <div className="list-card">
          <Table
            columns={pendingColumns}
            rows={pending.list}
            loading={pending.loading}
            error={pending.error}
            onRetry={pending.reload}
            emptyTitle="暂无待审核申请"
            emptyDesc="学生提交注册申请后会出现在此处。"
          />
          <Pagination
            page={pending.page}
            pageSize={pending.pageSize}
            total={pending.total}
            onChange={pending.setPage}
            onPageSizeChange={pending.setPageSize}
          />
        </div>
      )}

      {/* 新建账号 */}
      <Modal
        open={modal?.type === 'create'}
        title="新建账号"
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              取消
            </Button>
            <Button variant="primary" loading={submitting} onClick={submitCreate}>
              创建并生成初始密码
            </Button>
          </>
        }
      >
        <div className="form-grid-2">
          <FormField label="学号 / 工号" required error={errs.username}>
            {(f) => (
              <Input
                id={f.id}
                value={form.username}
                invalid={f.invalid}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="4~32 位字母数字"
              />
            )}
          </FormField>
          <FormField label="姓名" required error={errs.realName}>
            {(f) => (
              <Input
                id={f.id}
                value={form.realName}
                invalid={f.invalid}
                onChange={(e) => setForm({ ...form, realName: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="角色" required error={errs.roleCode}>
            {(f) => (
              <Select
                id={f.id}
                value={form.roleCode}
                onChange={(e) => setForm({ ...form, roleCode: e.target.value })}
              >
                <option value="student">学生</option>
                <option value="teacher">教师</option>
                <option value="admin">管理员</option>
              </Select>
            )}
          </FormField>
          <FormField label="班级" required={form.roleCode === 'student'} error={errs.classId}>
            {(f) => (
              <Select
                id={f.id}
                invalid={f.invalid}
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
              >
                <option value="">{form.roleCode === 'student' ? '请选择班级' : '不适用'}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.className}（{c.classCode}）
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="邮箱" error={errs.email}>
            {(f) => (
              <Input
                id={f.id}
                type="email"
                value={form.email}
                invalid={f.invalid}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="手机号" error={errs.phone}>
            {(f) => (
              <Input
                id={f.id}
                value={form.phone}
                invalid={f.invalid}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <FormField label="部门" hint="教师/管理员可填">
          {(f) => (
            <Input
              id={f.id}
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          )}
        </FormField>
        <FormField label="备注" error={errs.remark}>
          {(f) => (
            <Textarea
              id={f.id}
              rows={2}
              invalid={f.invalid}
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
            />
          )}
        </FormField>
        <div className="alert-bar info">初始密码将在创建成功后展示一次，请及时转告用户。</div>
      </Modal>

      {/* 编辑资料 */}
      <Modal
        open={modal?.type === 'edit'}
        title={`编辑用户：${modal?.user?.realName || ''}`}
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={submitEdit}>保存</Button>
          </>
        }
      >
        <div className="form-grid-2">
          <FormField label="姓名" required error={errs.realName}>
            {(f) => (
              <Input id={f.id} invalid={f.invalid} value={form.realName} onChange={(e) => setForm({ ...form, realName: e.target.value })} />
            )}
          </FormField>
          <FormField label="邮箱" error={errs.email}>
            {(f) => (
              <Input id={f.id} type="email" invalid={f.invalid} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            )}
          </FormField>
          <FormField label="手机号" error={errs.phone}>
            {(f) => <Input id={f.id} invalid={f.invalid} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </FormField>
          <FormField label="班级">
            {(f) => (
              <Select id={f.id} value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">不适用</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.className}</option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        <FormField label="部门">
          {(f) => <Input id={f.id} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />}
        </FormField>
        <FormField label="备注" error={errs.remark}>
          {(f) => <Textarea id={f.id} rows={2} invalid={f.invalid} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />}
        </FormField>
      </Modal>

      {/* 调整角色 */}
      <Modal
        open={modal?.type === 'role'}
        title={`调整角色：${modal?.user?.realName || ''}`}
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={() => changeRole(modal.user, form.roleCode)}>
              确认调整
            </Button>
          </>
        }
      >
        <FormField label="目标角色" required>
          {(f) => (
            <Select id={f.id} value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              <option value="student">学生</option>
              <option value="teacher">教师</option>
              <option value="admin">管理员</option>
            </Select>
          )}
        </FormField>
        <div className="alert-bar">
          角色调整会使该用户旧令牌立即失效（token_version +1），下一次请求按新权限判定，并写入审计日志。
        </div>
      </Modal>

      {/* 禁用 / 启用 */}
      <Modal
        open={modal?.type === 'disable' || modal?.type === 'enable'}
        title={modal?.type === 'disable' ? '禁用账号' : '启用账号'}
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>取消</Button>
            <Button
              variant={modal?.type === 'disable' ? 'danger' : 'primary'}
              loading={submitting}
              onClick={() => changeStatus(modal.user, modal?.type === 'disable' ? 'disabled' : 'active')}
            >
              {modal?.type === 'disable' ? '确认禁用' : '确认启用'}
            </Button>
          </>
        }
      >
        <p style={{ marginBottom: 12, lineHeight: 1.7 }}>
          对象：<b>{modal?.user?.realName}</b>（{modal?.user?.username}）
        </p>
        {modal?.type === 'disable' ? (
          <>
            <FormField label="禁用原因" hint="将写入安全审计日志">
              {(f) => <Input id={f.id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：账号存在异常登录" />}
            </FormField>
            <div className="alert-bar danger">禁用后该账号立即无法登录，已签发令牌的后续请求也会被拒绝。</div>
          </>
        ) : (
          <div className="alert-bar info">启用后该账号可正常登录，历史考试与成绩不受影响。</div>
        )}
      </Modal>

      {/* 重置密码 */}
      <Modal
        open={modal?.type === 'reset'}
        title="重置密码"
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={() => doResetPassword(modal.user)}>确认重置</Button>
          </>
        }
      >
        <p style={{ lineHeight: 1.8 }}>
          将为 <b>{modal?.user?.realName}</b> 生成一次性临时密码，并吊销其全部 Refresh Token，需重新登录。
        </p>
      </Modal>

      {/* 驳回注册 */}
      <Modal
        open={modal?.type === 'reject'}
        title="驳回注册申请"
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>取消</Button>
            <Button variant="danger" loading={submitting} onClick={() => doReject(modal.user)}>确认驳回</Button>
          </>
        }
      >
        <FormField label="驳回原因" required error={errs.reason}>
          {(f) => (
            <Textarea
              id={f.id}
              rows={3}
              invalid={f.invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：学号与教务名单不一致，请核对后重新提交"
            />
          )}
        </FormField>
      </Modal>

      {/* 一次性凭证 */}
      <Modal
        open={Boolean(credential)}
        title={credential?.title || '凭证'}
        onClose={() => setCredential(null)}
        footer={<Button variant="primary" onClick={() => setCredential(null)}>我已记录</Button>}
      >
        <div
          className="mono"
          style={{
            padding: '16px 18px',
            borderRadius: 8,
            border: '1px dashed var(--oe-accent)',
            background: '#eff9fb',
            fontSize: 18,
            textAlign: 'center',
            letterSpacing: '0.04em',
            wordBreak: 'break-all',
          }}
        >
          {credential?.value}
        </div>
        <div className="alert-bar" style={{ marginTop: 14 }}>
          出于安全考虑，该凭证仅本次响应返回，关闭后无法再次查看。
        </div>
      </Modal>
    </div>
  );
}