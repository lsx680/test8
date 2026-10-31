import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/uiStore.js';
import { FormField, Input } from '../../components/Form.jsx';
import Button from '../../components/Button.jsx';
import { required, runRules } from '../../utils/validate.js';

/**
 * 登录页（REQ-UAM-01 / REQ-UAM-02）
 * 契约：POST /auth/login → { tokens, user, homeRoute }
 * 注意：契约 LoginRequest 含 captchaId/captchaCode（描述为生产环境必填），
 *      但契约未定义验证码下发端点，前端暂不渲染验证码控件（见任务报告的契约缺口）。
 */
const FEATURES = [
  ['01', '服务端权威计时', '剩余时间以服务端为准，断线重连不重复计时'],
  ['02', '客观题自动判分', '交卷即判分，主观题进入人工阅卷队列'],
  ['03', '双评与争议仲裁', '分差超过阈值自动转入仲裁，全程留痕'],
  ['04', '教学诊断统计', '分数段分布、正确率、区分度与知识点失分'],
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const login = useAuthStore((s) => s.login);

  const [form, setForm] = useState({ username: '', password: '' });
  const [errs, setErrs] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const update = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setErrs((prev) => ({ ...prev, [key]: undefined }));
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const result = runRules(form, {
      username: [(v) => required(v, '学号/工号')],
      password: [(v) => required(v, '密码')],
    });
    setErrs(result.errors);
    if (!result.valid) return;

    setLoading(true);
    setFormError('');
    try {
      const data = await login({ username: form.username.trim(), password: form.password });
      toast.success(`欢迎回来，${data.user?.realName || data.user?.username || ''}`);
      const redirect = search.get('redirect');
      const target = redirect ? decodeURIComponent(redirect) : data.homeRoute;
      navigate(target || '/', { replace: true });
    } catch (err) {
      // 登录失败不跳转；展示原因 + 下一步建议
      setFormError(err?.displayMessage || err?.message || '登录失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-visual">
        <div className="auth-orb" aria-hidden="true" />

        <div className="auth-brand">
          <span className="brand-mark">OES</span>
          <span className="brand-text">
            <span className="brand-name">在线考试系统</span>
            <span className="brand-sub">Online Examination System</span>
          </span>
        </div>

        <div className="auth-hero">
          <div className="auth-eyebrow">
            <span className="dot" aria-hidden="true" />
            EXAM FLOW · 全流程闭环
          </div>
          <h1 className="auth-title">
            <span>让每一次考试</span>
            <span className="neon-text">都有据可查</span>
          </h1>
          <p className="auth-lead">
            从题库建设、规则化组卷、在线答题、自动判分到人工阅卷与成绩分析，
            覆盖课程级正式考试的完整链路。答案保护、幂等交卷与审计留痕，让考试结果可解释、可追溯。
          </p>

          <div className="auth-features">
            {FEATURES.map(([no, title, desc]) => (
              <div className="auth-feature" key={no}>
                <i aria-hidden="true">{no}</i>
                <div>
                  <b>{title}</b>
                  <span>{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-foot">
          <span>
            接口端点 <b>102</b>
          </span>
          <span>
            业务模块 <b>07</b>
          </span>
          <span>
            角色 <b>03</b>
          </span>
          <span>
            接口契约 <b>OpenAPI 3.0.3</b>
          </span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card on-dark">
          <div className="auth-card-head">
            <h2 className="auth-card-title">登录考试终端</h2>
            <p className="auth-card-desc">使用学号或工号登录，系统将按角色进入对应工作台</p>
          </div>

          {formError ? (
            <div className="auth-error" role="alert">
              <span aria-hidden="true">!</span>
              <span>{formError}</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate>
            <FormField label="学号 / 工号" required error={errs.username} htmlFor="login-username">
              <Input
                id="login-username"
                autoComplete="username"
                placeholder="如 S2024001"
                value={form.username}
                invalid={Boolean(errs.username)}
                onChange={update('username')}
                autoFocus
              />
            </FormField>

            <FormField label="密码" required error={errs.password} htmlFor="login-password">
              <div style={{ position: 'relative' }}>
                <Input
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="请输入登录密码"
                  value={form.password}
                  invalid={Boolean(errs.password)}
                  onChange={update('password')}
                  style={{ paddingRight: 64 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 12,
                    color: 'var(--oe-text-dim)',
                    padding: '2px 6px',
                  }}
                >
                  {showPwd ? '隐藏' : '显示'}
                </button>
              </div>
            </FormField>

            <Button type="submit" variant="primary" block loading={loading}>
              登录
            </Button>
          </form>

          <div className="auth-switch">
            还没有账号？<Link to="/register">提交学生注册申请</Link>
          </div>

          <div className="auth-demo">
            <div>· 学生账号由管理员审核通过后方可登录（REQ-UAM-06）</div>
            <div>· 连续 5 次密码错误将锁定账号 15 分钟（REQ-UAM-02）</div>
            <div>· 演示账号请向管理员获取，或使用后端初始化脚本创建</div>
          </div>

          <div className="auth-foot" style={{ marginTop: 14, fontSize: 11 }}>
            <span>当前来源 {location.pathname}</span>
          </div>
        </div>
      </section>
    </div>
  );
}