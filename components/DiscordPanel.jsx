"use client";
import { useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import { normalizeDiscord, ROUTE_KINDS, MAX_HOOKS } from "@/lib/discord-routing";

const newId = () => `h_${Math.random().toString(36).slice(2, 9)}`;

// Event kinds that actually fire notify() (lib/discord-routing EVENT_KINDS/PLAYER_KINDS,
// minus chat which is relayed separately) and the placeholders each one can use.
const TEMPLATE_KINDS = [
  { kind: "start", placeholders: ["world", "time"] },
  { kind: "stop", placeholders: ["world", "time"] },
  { kind: "join", placeholders: ["world", "player", "time"] },
  { kind: "leave", placeholders: ["world", "player", "time"] },
  { kind: "crash", placeholders: ["world", "code", "time"] },
  { kind: "restart", placeholders: ["world", "time"] },
  { kind: "update", placeholders: ["world", "build", "time"] },
  { kind: "backup", placeholders: ["world", "reason", "size", "time"] },
  // Player-death variants (fed by the PSMDeathRelay mod). All route through the single
  // "death" channel; each variant is its own template so a Pal kill, a PvP kill, and an
  // environmental death (fall/drown/…) can read differently.
  { kind: "death_pal", placeholders: ["world", "player", "pal", "cause", "time"] },
  { kind: "death_player", placeholders: ["world", "player", "killer", "cause", "time"] },
  { kind: "death_env", placeholders: ["world", "player", "cause", "time"] },
];

export default function DiscordPanel({ world, onChange }) {
  const { t } = useTranslation();
  const initial = useMemo(
    () => normalizeDiscord(world),
    [world.discord_webhooks, world.discord_webhook, world.notify_events, world.discord_relay_chat]
  );
  const initialTemplates = useMemo(() => {
    try { return world.notify_templates ? JSON.parse(world.notify_templates) : {}; } catch { return {}; }
  }, [world.notify_templates]);

  const [hooks, setHooks] = useState(initial.hooks);
  const [routes, setRoutes] = useState(initial.routes);
  const [templates, setTemplates] = useState(initialTemplates);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const dirty = JSON.stringify({ hooks, routes }) !== JSON.stringify(initial)
    || JSON.stringify(templates) !== JSON.stringify(initialTemplates);

  const addHook = () => {
    if (hooks.length >= MAX_HOOKS) return;
    setHooks((hs) => [...hs, { id: newId(), name: `Channel ${hs.length + 1}`, url: "" }]);
  };
  const patchHook = (id, patch) => setHooks((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const removeHook = (id) => {
    setHooks((hs) => hs.filter((h) => h.id !== id));
    setRoutes((rs) => {
      const next = { ...rs };
      for (const k of ROUTE_KINDS) if (next[k] === id) next[k] = "";
      return next;
    });
  };
  const setRoute = (kind, hookId) => setRoutes((rs) => ({ ...rs, [kind]: hookId }));

  const discard = () => { setHooks(initial.hooks); setRoutes(initial.routes); setTemplates(initialTemplates); };
  const setTemplate = (kind, value) => setTemplates((tm) => ({ ...tm, [kind]: value }));

  const sendTest = async (hook) => {
    setTestingId(hook.id);
    try {
      await api("/api/settings/test-notify", { method: "POST", body: { webhook: hook.url.trim() } });
      toast(t("discord.testSent"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setTestingId(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      // Trim, and drop empty channels nothing routes to; clear routes to dropped ones.
      const cleanedHooks = hooks
        .map((h) => ({ id: h.id, name: h.name.trim() || t("discord.webhookFallback"), url: h.url.trim() }))
        .filter((h) => h.url || ROUTE_KINDS.some((k) => routes[k] === h.id));
      const validIds = new Set(cleanedHooks.map((h) => h.id));
      const cleanedRoutes = {};
      for (const k of ROUTE_KINDS) cleanedRoutes[k] = validIds.has(routes[k]) ? routes[k] : "";
      // Drop blank templates so a kind falls back to the built-in default message.
      const cleanedTemplates = {};
      for (const { kind } of TEMPLATE_KINDS) {
        const v = (templates[kind] || "").trim();
        if (v) cleanedTemplates[kind] = v;
      }
      await api(`/api/worlds/${world.world_id}`, {
        method: "PATCH",
        body: { discord_webhooks: { hooks: cleanedHooks, routes: cleanedRoutes }, notify_templates: cleanedTemplates },
      });
      toast(t("discord.saved"), "success");
      onChange?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const hookById = (id) => hooks.find((h) => h.id === id);

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <section>
        <h3 className="heading" style={{ fontSize: "1.05rem", marginTop: 0 }}>{t("discord.notificationsTitle")}</h3>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: 0, marginBottom: "0.9rem" }}>
          <Trans i18nKey="discord.notificationsDesc" components={{ b: <b /> }} />
        </p>

        {/* ---- Webhook channels ---- */}
        <label className="label">{t("discord.channels")}</label>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {hooks.length === 0 && (
            <div className="panel-inset" style={{ padding: "0.9rem 1.1rem" }}>
              <span className="subtle" style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                {t("discord.noChannels")}
              </span>
            </div>
          )}
          {hooks.map((h) => (
            <div key={h.id} className="panel-inset" style={{ padding: "0.7rem 0.9rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="input" value={h.name} onChange={(e) => patchHook(h.id, { name: e.target.value })}
                placeholder={t("discord.channelNamePlaceholder")} style={{ width: 150 }} aria-label={t("discord.channelNamePlaceholder")} />
              <input
                className="input" value={h.url} onChange={(e) => patchHook(h.id, { url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/…" style={{ flex: 1, minWidth: 240 }} aria-label={t("discord.webhookUrl")} />
              <button className="btn btn-ghost" style={{ padding: "0.4rem 0.7rem" }}
                onClick={() => sendTest(h)} disabled={testingId === h.id || !h.url.trim()}>
                {testingId === h.id ? t("discord.sending") : t("discord.test")}
              </button>
              <button className="btn btn-danger" style={{ padding: "0.4rem 0.55rem" }}
                onClick={() => removeHook(h.id)} title={t("discord.removeChannel")} aria-label={t("discord.removeChannel")}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: "0.6rem", padding: "0.4rem 0.8rem" }}
          onClick={addHook} disabled={hooks.length >= MAX_HOOKS}>
          <Icon name="plus" size={15} /> {t("discord.addChannel")}
        </button>
        {hooks.length >= MAX_HOOKS && (
          <span className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", marginLeft: 8 }}>{t("discord.maxChannels", { max: MAX_HOOKS })}</span>
        )}
      </section>

      {/* ---- Per-event routing ---- */}
      <section>
        <label className="label">{t("discord.routeEvents")}</label>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 0, marginBottom: "0.7rem" }}>
          <Trans i18nKey="discord.routeDesc" components={{ b: <b /> }} />
        </p>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {ROUTE_KINDS.map((k) => {
            const routed = routes[k];
            const missingUrl = routed && !(hookById(routed)?.url || "").trim();
            const kindLabel = t(`discord.kind.${k}`);
            return (
              <div key={k} className="panel-inset" style={{ padding: "0.55rem 0.9rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                <div style={{ minWidth: 150, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{kindLabel}</div>
                  {k === "chat" && (
                    <div className="subtle" style={{ fontWeight: 600, fontSize: "0.72rem" }}>
                      <Trans i18nKey="discord.chatNeedsMod" components={{ b: <b /> }} />
                    </div>
                  )}
                  {missingUrl && (
                    <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "0.72rem" }}>
                      {t("discord.channelNoUrl")}
                    </div>
                  )}
                </div>
                <select className="input" style={{ width: 200 }} value={routed}
                  onChange={(e) => setRoute(k, e.target.value)} aria-label={t("discord.channelForAria", { event: kindLabel })}>
                  <option value="">{t("discord.dontSend")}</option>
                  {hooks.map((h) => (
                    <option key={h.id} value={h.id}>{h.name.trim() || t("discord.webhookFallback")}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Custom message templates ---- */}
      <section>
        <label className="label">{t("discord.templatesTitle")}</label>
        <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", marginTop: 0, marginBottom: "0.7rem" }}>
          {t("discord.templatesDesc")}
        </p>
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {TEMPLATE_KINDS.map(({ kind, placeholders }) => (
            <div key={kind} className="panel-inset" style={{ padding: "0.7rem 0.9rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                <span style={{ fontWeight: 800, fontSize: "0.84rem" }}>{t(`discord.kind.${kind}`)}</span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {placeholders.map((p) => (
                    <code key={p} title={t("discord.insertPlaceholder")} onClick={() => setTemplate(kind, `${templates[kind] || ""}{${p}}`)}
                      style={{ cursor: "pointer", fontSize: "0.68rem", padding: "1px 5px", borderRadius: 5, background: "var(--card-2)", fontWeight: 700 }}>
                      {`{${p}}`}
                    </code>
                  ))}
                </span>
              </div>
              <textarea
                className="input" value={templates[kind] || ""} onChange={(e) => setTemplate(kind, e.target.value)}
                rows={2} spellCheck={false} placeholder={t(`discord.tplDefault.${kind}`)}
                style={{ width: "100%", resize: "vertical", fontSize: "0.82rem", lineHeight: 1.4, minHeight: 38 }} />
            </div>
          ))}
        </div>
      </section>

      {/* Unsaved-changes bar */}
      <div className="panel-inset" style={{
        padding: "0.8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "1rem", flexWrap: "wrap",
        borderLeft: `3px solid ${dirty ? "var(--yellow)" : "var(--line)"}`,
      }}>
        <span style={{ fontWeight: 700, fontSize: "0.82rem" }} className={dirty ? "" : "subtle"}>
          {dirty ? t("discord.unsavedChanges") : t("discord.allSaved")}
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-ghost" onClick={discard} disabled={!dirty || saving}>{t("discord.discard")}</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            <Icon name="download" size={16} /> {saving ? t("discord.saving") : t("discord.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
