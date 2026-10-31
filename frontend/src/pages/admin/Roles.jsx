import { useFetch } from '../../hooks/useFetch.js';
import { listPermissions, listRoles } from '../../api/users.js';
import PageHeader from '../../components/PageHeader.jsx';
import Loading from '../../components/Loading.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Tag from '../../components/Tag.jsx';
import { ROLE_LABEL } from '../../utils/enums.js';

/**
 * 角色与权限（REQ-UAM-08）
 * 契约说明：
 * - GET /roles 返回角色基础信息（roleCode / roleName / isBuiltin）
 * - GET /permissions 返回权限点字典（permCode / permName / module）
 * - 调整用户角色通过 PATCH /users/{userId}/role 完成
 *
 * 契约缺口（详见任务报告）：未定义「角色 → 权限点」映射查询端点，
 * 因此本页只展示权限点字典与角色定义，不伪造角色权限映射。
 */
const ROLE_MATRIX_NOTE = {
  admin: '全量数据与配置权限：账号治理、知识点字典、考试监管、争议仲裁、参数与审计日志。',
  teacher: '教学执行权限：本人题库/试卷/考试、主观题阅卷、成绩统计与发布；数据范围受创建者/授权关系约束。',
  student: '考试参与权限：本人可参加的考试、在线答题、本人成绩与成绩复核申诉。',
};

const MODULE_LABEL = {
  uam: '用户与权限',
  qbm: '题库管理',
  ppm: '试卷与组卷',
  exm: '考试与答题',
  mrk: '阅卷与复核',
  sta: '成绩统计',
  sys: '系统管理',
};

export default function AdminRoles() {
  const roles = useFetch(listRoles, []);
  const permissions = useFetch(listPermissions, []);

  const grouped = (permissions.data || []).reduce((acc, p) => {
    const key = p.module || 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="page">
      <PageHeader
        title="角色与权限"
        desc="系统采用 RBAC：权限点授予角色、角色授予用户。前端菜单仅作体验优化，接口级权限校验在服务端执行。"
      />

      <div className="alert-bar info" style={{ marginBottom: 16 }}>
        角色调整入口位于「账号管理 → 调整角色」。变更后旧令牌立即失效（token_version +1），下一次请求即按新权限判定并写入审计日志。
      </div>

      <section className="form-section">
        <h2 className="form-section-title">内置角色</h2>
        {roles.loading ? (
          <Loading text="正在加载角色…" />
        ) : roles.error ? (
          <ErrorState message={roles.error} onRetry={roles.reload} />
        ) : (
          <div className="metric-grid">
            {(roles.data || []).map((role) => (
              <div className="metric" key={role.id || role.roleCode}>
                <div className="row-between">
                  <span className="metric-label">{role.roleCode?.toUpperCase()}</span>
                  {role.isBuiltin ? <Tag tone="cyan">内置</Tag> : <Tag>自定义</Tag>}
                </div>
                <div className="metric-value" style={{ fontSize: 20 }}>
                  {role.roleName || ROLE_LABEL[role.roleCode] || role.roleCode}
                </div>
                <p className="metric-foot" style={{ lineHeight: 1.7, marginTop: 8 }}>
                  {ROLE_MATRIX_NOTE[role.roleCode] || role.description || '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="form-section">
        <h2 className="form-section-title">权限点字典</h2>
        {permissions.loading ? (
          <Loading text="正在加载权限点…" />
        ) : permissions.error ? (
          <ErrorState message={permissions.error} onRetry={permissions.reload} />
        ) : (
          Object.entries(grouped).map(([module, items]) => (
            <div key={module} style={{ marginBottom: 22 }}>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <b className="small">{MODULE_LABEL[module] || module}</b>
                <span className="xs muted">{items.length} 个权限点</span>
              </div>
              <div className="perm-grid">
                {items.map((p) => (
                  <div className="perm-item" key={p.id || p.permCode}>
                    <code>{p.permCode}</code>
                    <span className="small">{p.permName}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <div className="alert-bar">
        契约未提供「角色 → 权限点」映射查询接口，因此本页不展示角色对应的权限点集合。
        如需完整权限矩阵，请参考需求规格说明书第 3.2 节。
      </div>
    </div>
  );
}