import { useEffect, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import type { Usuario } from "../../lib/useAuth"
import s from "./admin.module.css"
import ss from "./Sorteio.module.css"

type Ctx = { usuario: Usuario; nomeTime: string }

type Jogo = {
  id: string
  data: string
  horario: string
  local: string
  status: string
  max_jogadores: number | null
}

type JogadorSorteio = {
  time_label: string
  jogador_id: string | null
  convidado_id: string | null
  nome: string
  rating: number
}

type Time = { label: string; jogadores: JogadorSorteio[] }

const MIN_CONFIRMADOS = 12

function fmtData(iso: string) {
  const [a, m, d] = iso.split("-")
  return `${d}/${m}/${a}`
}
function fmtHora(h: string) { return h.slice(0, 5) }
function diaSemana(iso: string) {
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
  const [a, m, d] = iso.split("-").map(Number)
  return dias[new Date(a, m - 1, d).getDay()]
}
function mediaRating(jogs: JogadorSorteio[]) {
  if (!jogs.length) return 0
  return (jogs.reduce((s, j) => s + j.rating, 0) / jogs.length).toFixed(1)
}

export default function Sorteio() {
  const { usuario } = useOutletContext<Ctx>()
  const [jogo, setJogo] = useState<Jogo | null>(null)
  const [times, setTimes] = useState<Time[]>([])
  const [loading, setLoading] = useState(true)
  const [sorteando, setSorteando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [confirmarExcluir, setConfirmarExcluir] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sorteioSalvo, setSorteioSalvo] = useState(false)
  const [numConfirmados, setNumConfirmados] = useState(0)
  const [todosJogadores, setTodosJogadores] = useState<{ id: string; nome: string }[]>([])
  const [confirmadosIds, setConfirmadosIds] = useState<Set<string>>(new Set())
  const [extrasIds, setExtrasIds] = useState<Set<string>>(new Set())
  const [numTimes, setNumTimes] = useState<string>("")
  const [tamTime, setTamTime] = useState<string>("")
  const [selTime, setSelTime] = useState<Record<string, string>>({})
  const [adicionandoId, setAdicionandoId] = useState<string | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    setErro(null)
    const hoje = new Date().toISOString().split("T")[0]

    const { data: jogos } = await supabase
      .from("jogos")
      .select("*")
      .eq("patota_id", usuario.patota_id)
      .gte("data", hoje)
      .in("status", ["agendado", "confirmado"])
      .order("data")
      .limit(1)

    const proximoJogo = jogos?.[0] ?? null
    setJogo(proximoJogo)

    // Carrega todos os jogadores da patota
    const { data: jogs } = await supabase
      .from("jogadores")
      .select("id, nome")
      .eq("patota_id", usuario.patota_id)
      .eq("ativo", true)
      .order("nome")
    setTodosJogadores(jogs ?? [])

    if (proximoJogo) {
      // conta confirmados e guarda quais jogadores confirmaram
      const { data: presConf } = await supabase
        .from("presencas")
        .select("jogador_id, convidado, aprovado")
        .eq("jogo_id", proximoJogo.id)
        .eq("confirmado", true)
      // Mesma regra do RPC sortear_times: jogadores confirmados + convidados aprovados
      const lista = (presConf ?? []) as { jogador_id: string | null; convidado: boolean | null; aprovado: boolean | null }[]
      const ids = new Set(lista.filter(p => !p.convidado && p.jogador_id).map(p => p.jogador_id as string))
      setConfirmadosIds(ids)
      setNumConfirmados(ids.size + lista.filter(p => p.convidado && p.aprovado).length)

      const { data: salvo } = await supabase
        .from("sorteio_times")
        .select("*")
        .eq("jogo_id", proximoJogo.id)
        .order("criado_em", { ascending: false })

      if (salvo && salvo.length > 0) {
        setTimes(agrupar(salvo))
        setSorteioSalvo(true)
      }
    }

    setLoading(false)
  }

  function agrupar(rows: JogadorSorteio[]): Time[] {
    const mapa = new Map<string, JogadorSorteio[]>()
    for (const r of rows) {
      const arr = mapa.get(r.time_label) ?? []
      arr.push(r)
      mapa.set(r.time_label, arr)
    }
    return Array.from(mapa.entries()).map(([label, jogadores]) => ({ label, jogadores }))
  }

  function toggleExtra(id: string) {
    setExtrasIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const totalParaSortear = numConfirmados + extrasIds.size

  async function sortear() {
    if (!jogo) return
    if (totalParaSortear < MIN_CONFIRMADOS) {
      setErro(`São necessários pelo menos ${MIN_CONFIRMADOS} confirmados para sortear. Atualmente: ${totalParaSortear}.`)
      return
    }
    setSorteando(true)
    setErro(null)

    // Registra presença confirmada dos extras. Não usa upsert: o índice único
    // (jogo_id, jogador_id) é parcial e o ON CONFLICT do PostgREST falha contra ele.
    const extras = Array.from(extrasIds).filter(id => !confirmadosIds.has(id))
    if (extras.length > 0) {
      const { data: existentes, error: errSel } = await supabase
        .from("presencas")
        .select("id, jogador_id")
        .eq("jogo_id", jogo.id)
        .in("jogador_id", extras)
      const jaExistem = new Set((existentes ?? []).map(p => p.jogador_id as string))
      const idsAtualizar = (existentes ?? []).map(p => p.id as string)
      const inserir = extras
        .filter(id => !jaExistem.has(id))
        .map(jogador_id => ({ jogo_id: jogo.id, jogador_id, confirmado: true, convidado: false, aprovado: false }))

      const errUpd = idsAtualizar.length > 0
        ? (await supabase.from("presencas").update({ confirmado: true, convidado: false }).in("id", idsAtualizar)).error
        : null
      const errIns = inserir.length > 0
        ? (await supabase.from("presencas").insert(inserir)).error
        : null

      const falha = errSel ?? errUpd ?? errIns
      if (falha) {
        await carregar()
        setErro(`Não foi possível registrar a presença dos jogadores marcados: ${falha.message}`)
        setSorteando(false)
        return
      }
    }
    const esperado = totalParaSortear

    const rpcArgs: Record<string, unknown> = { p_jogo_id: jogo.id }
    const tam = tamTime ? parseInt(tamTime) : 0
    const nt = numTimes ? parseInt(numTimes) : 0
    // Deriva p_num_times a partir de tamTime se preenchido (tamTime tem prioridade sobre numTimes)
    if (tam >= 2) {
      rpcArgs.p_num_times = Math.max(2, Math.ceil(totalParaSortear / tam))
    } else if (nt >= 2) {
      rpcArgs.p_num_times = nt
    }

    const { data, error } = await supabase.rpc("sortear_times", rpcArgs)

    if (error) {
      const msg = error.message.includes("admin")
        ? "Apenas administradores podem sortear times."
        : error.message.includes("jogadores")
        ? "Confirmados insuficientes para formar times."
        : `Erro: ${error.message}`
      setErro(msg)
      setSorteando(false)
      return
    }

    if (!data || data.length === 0) {
      setErro("Nenhum jogador confirmado para sortear.")
      setSorteando(false)
      return
    }

    await supabase.from("sorteio_times").delete().eq("jogo_id", jogo.id)

    const rows = (data as JogadorSorteio[]).map(r => ({
      jogo_id: jogo.id,
      patota_id: usuario.patota_id,
      time_label: r.time_label,
      jogador_id: r.jogador_id ?? null,
      convidado_id: r.convidado_id ?? null,
      nome: r.nome,
      rating: r.rating,
    }))

    await supabase.from("sorteio_times").insert(rows)

    // Os extras agora são presenças confirmadas: recarrega para não contá-los em dobro
    setExtrasIds(new Set())
    await carregar()
    if (data.length !== esperado) {
      setErro(`Atenção: ${data.length} jogadores foram sorteados, mas o total esperado era ${esperado}.`)
    }
    setSorteando(false)
  }

  async function removerConfirmado(jogadorId: string) {
    if (!jogo) return
    const { error } = await supabase
      .from("presencas")
      .update({ confirmado: false })
      .eq("jogo_id", jogo.id)
      .eq("jogador_id", jogadorId)
    await carregar()
    if (error) setErro(`Não foi possível remover a presença: ${error.message}`)
  }

  async function adicionarAoTime(jogadorId: string, nome: string, timeLabel: string) {
    if (!jogo) return
    setAdicionandoId(jogadorId)
    setErro(null)

    const { data: jogadorRow, error: errNota } = await supabase
      .from("jogadores")
      .select("nota")
      .eq("id", jogadorId)
      .single()

    if (errNota) {
      setErro(`Não foi possível adicionar ${nome}: ${errNota.message}`)
      setAdicionandoId(null)
      return
    }

    const rating = jogadorRow?.nota ?? 3

    const { error } = await supabase.from("sorteio_times").insert({
      jogo_id: jogo.id,
      patota_id: usuario.patota_id,
      time_label: timeLabel,
      jogador_id: jogadorId,
      convidado_id: null,
      nome,
      rating,
    })

    setAdicionandoId(null)
    if (error) {
      setErro(`Não foi possível adicionar ${nome}: ${error.message}`)
      return
    }
    setSelTime(prev => {
      const next = { ...prev }
      delete next[jogadorId]
      return next
    })
    await carregar()
  }

  async function excluirSorteio() {
    if (!jogo) return
    setConfirmarExcluir(false)
    setExcluindo(true)
    setErro(null)
    const { error } = await supabase.from("sorteio_times").delete().eq("jogo_id", jogo.id)
    setExcluindo(false)
    if (error) {
      setErro(`Não foi possível excluir o sorteio: ${error.message}`)
      return
    }
    setTimes([])
    setSorteioSalvo(false)
  }

  const podeSortear = totalParaSortear >= MIN_CONFIRMADOS

  if (loading) return (
    <div className={s.page}>
      <div className={s.pageHeader}><h1 className={s.pageTitulo}>Sorteio de times</h1></div>
      <div className={ss.spinner} />
    </div>
  )

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <div className={s.pageTitulo}>Sorteio de times</div>
          <div className={s.pageSubtitulo}>Sorteio balanceado por nível</div>
        </div>
      </div>

      {jogo ? (
        <div className={ss.jogoCard}>
          <div className={ss.jogoIcon}>⚽</div>
          <div className={ss.jogoInfo}>
            <div className={ss.jogoData}>{diaSemana(jogo.data)}, {fmtData(jogo.data)} · {fmtHora(jogo.horario)}</div>
            <div className={ss.jogoLocal}>📍 {jogo.local}</div>
          </div>
          <div className={ss.jogoBadge} style={{ color: totalParaSortear >= MIN_CONFIRMADOS ? "#16a34a" : "#dc2626" }}>
            {numConfirmados}/{MIN_CONFIRMADOS} confirmados{extrasIds.size > 0 ? ` (+${extrasIds.size})` : ""}
          </div>
        </div>
      ) : (
        <div className={ss.vazio}>
          <div className={ss.vazioIcon}>📅</div>
          <div>Nenhum jogo agendado. Crie um jogo primeiro.</div>
        </div>
      )}

      {jogo && (
        <>
          {confirmadosIds.size > 0 && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)", marginBottom: "0.25rem" }}>
                Jogadores confirmados ({confirmadosIds.size})
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.6rem" }}>
                Clique no ✕ para tirar a presença de um jogador. Ele volta para a lista de inclusão manual.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {todosJogadores.filter(j => confirmadosIds.has(j.id)).map(j => (
                  <span key={j.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.3rem 0.4rem 0.3rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", fontSize: "0.82rem", color: "var(--text)" }}>
                    {j.nome}
                    <button
                      onClick={() => removerConfirmado(j.id)}
                      title={`Remover presença de ${j.nome}`}
                      aria-label={`Remover presença de ${j.nome}`}
                      style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontWeight: 700, padding: "0 0.2rem", fontSize: "0.85rem" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Jogadores não confirmados que admin pode incluir manualmente */}
          {todosJogadores.filter(j => !confirmadosIds.has(j.id)).length > 0 && (() => {
            const naoConfirmados = todosJogadores.filter(j => !confirmadosIds.has(j.id))
            const todosMarcados = naoConfirmados.every(j => extrasIds.has(j.id))
            return (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)" }}>
                    Incluir manualmente no sorteio
                  </div>
                  <button
                    style={{ fontSize: "0.78rem", color: "var(--primary, #6366f1)", background: "none", border: "none", cursor: "pointer", padding: "0.1rem 0.3rem", fontWeight: 600 }}
                    onClick={() => {
                      if (todosMarcados) {
                        setExtrasIds(new Set())
                      } else {
                        setExtrasIds(new Set(naoConfirmados.map(j => j.id)))
                      }
                    }}
                  >
                    {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
                  </button>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.6rem" }}>
                  Marque jogadores que vão aparecer mas ainda não confirmaram no app. A presença deles será registrada como confirmada.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {naoConfirmados.map(j => (
                    <label key={j.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", padding: "0.3rem 0.6rem", borderRadius: 6, border: `1px solid ${extrasIds.has(j.id) ? "var(--primary, #6366f1)" : "var(--border)"}`, background: extrasIds.has(j.id) ? "var(--accent-bg, #eef2ff)" : "var(--surface2)", fontSize: "0.82rem", fontWeight: extrasIds.has(j.id) ? 600 : 400, color: "var(--text)" }}>
                      <input type="checkbox" checked={extrasIds.has(j.id)} onChange={() => toggleExtra(j.id)} style={{ width: 14, height: 14, cursor: "pointer" }} />
                      {j.nome}
                    </label>
                  ))}
                </div>
                {extrasIds.size > 0 && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                    {extrasIds.size} extra{extrasIds.size !== 1 ? "s" : ""} selecionado{extrasIds.size !== 1 ? "s" : ""} · total para sorteio: {totalParaSortear}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Configuração do sorteio */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)", marginBottom: "0.6rem" }}>Configuração do sorteio</div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                  Nº de times
                </label>
                <select
                  value={numTimes}
                  onChange={e => setNumTimes(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: "0.85rem" }}
                >
                  <option value="">Automático</option>
                  {[2,3,4,5,6].map(n => <option key={n} value={n}>{n} times</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                  Jogadores por time
                </label>
                <input
                  type="number"
                  min={2}
                  max={15}
                  placeholder="Automático"
                  value={tamTime}
                  onChange={e => setTamTime(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.5rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: "0.85rem", boxSizing: "border-box" }}
                />
              </div>
            </div>
            {(() => {
              const tam = tamTime ? parseInt(tamTime) : 0
              const nt = numTimes ? parseInt(numTimes) : 0
              const timesEfetivos = tam >= 2 ? Math.max(2, Math.ceil(totalParaSortear / tam)) : nt >= 2 ? nt : 0
              const vagasEfetivas = tam >= 2 ? timesEfetivos * tam : nt >= 2 ? nt * Math.ceil(totalParaSortear / nt) : 0
              if (timesEfetivos > 0 && vagasEfetivas > totalParaSortear + 2) {
                return (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "#d97706" }}>
                    ⚠️ Com {tam >= 2 ? `${tam} jogadores/time` : `${nt} times`} serão formados {timesEfetivos} times, mas há apenas {totalParaSortear} confirmados — alguns times ficam menores.
                  </div>
                )
              }
              return null
            })()}
            {(!numTimes || !tamTime) && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                Deixe em branco para usar o cálculo automático.
              </div>
            )}
          </div>

          {!podeSortear && totalParaSortear < MIN_CONFIRMADOS && (
            <div className={ss.erro} style={{ background: "#fef9c3", borderColor: "#f59e0b", color: "#92400e" }}>
              Aguardando mais jogadores. Mínimo de {MIN_CONFIRMADOS} para sortear (faltam {MIN_CONFIRMADOS - totalParaSortear}).
            </div>
          )}

          {erro && <div className={ss.erro}>{erro}</div>}

          <button
            className={ss.btnSortear}
            onClick={sortear}
            disabled={sorteando || totalParaSortear < MIN_CONFIRMADOS}
            style={totalParaSortear < MIN_CONFIRMADOS ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          >
            {sorteando ? (
              <><span className={ss.btnSpinner} /> Sorteando...</>
            ) : sorteioSalvo ? (
              "🎲 Sortear novamente"
            ) : (
              "🎲 Sortear times"
            )}
          </button>

          {sorteioSalvo && !confirmarExcluir && (
            <button
              onClick={() => setConfirmarExcluir(true)}
              disabled={excluindo || sorteando}
              style={{ display: "block", width: "100%", marginTop: "0.5rem", padding: "0.55rem", borderRadius: 8, border: "1px solid #fca5a5", background: "transparent", color: "#dc2626", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
            >
              {excluindo ? "Excluindo..." : "🗑️ Excluir sorteio"}
            </button>
          )}
          {sorteioSalvo && confirmarExcluir && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem", padding: "0.55rem 0.75rem", borderRadius: 8, border: "1px solid #fca5a5", fontSize: "0.85rem", color: "var(--text)" }}>
              <span style={{ flex: 1, minWidth: 180 }}>Excluir o sorteio salvo? As presenças não são alteradas.</span>
              <button
                onClick={excluirSorteio}
                style={{ padding: "0.35rem 0.8rem", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                Sim, excluir
              </button>
              <button
                onClick={() => setConfirmarExcluir(false)}
                style={{ padding: "0.35rem 0.8rem", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          )}

          {sorteioSalvo && times.length > 0 && (() => {
            const idsNoSorteio = new Set(
              times.flatMap(t => t.jogadores.map(j => j.jogador_id)).filter((id): id is string => !!id)
            )
            const pendentes = todosJogadores.filter(j => confirmadosIds.has(j.id) && !idsNoSorteio.has(j.id))
            if (pendentes.length === 0) return null
            return (
              <div style={{ background: "var(--surface)", border: "1px solid #f59e0b", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)", marginBottom: "0.25rem" }}>
                  Confirmaram depois do sorteio ({pendentes.length})
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.6rem" }}>
                  Escolha o time e adicione cada um sem refazer o sorteio inteiro.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {pendentes.map(j => (
                    <div key={j.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ flex: 1, fontSize: "0.85rem", color: "var(--text)" }}>{j.nome}</span>
                      <select
                        value={selTime[j.id] ?? times[0]?.label ?? ""}
                        onChange={e => setSelTime(prev => ({ ...prev, [j.id]: e.target.value }))}
                        style={{ padding: "0.3rem 0.4rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: "0.82rem" }}
                      >
                        {times.map(t => <option key={t.label} value={t.label}>Time {t.label}</option>)}
                      </select>
                      <button
                        onClick={() => adicionarAoTime(j.id, j.nome, selTime[j.id] ?? times[0]?.label ?? "")}
                        disabled={adicionandoId === j.id}
                        style={{ padding: "0.3rem 0.7rem", borderRadius: 6, border: "none", background: "var(--primary, #6366f1)", color: "#fff", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}
                      >
                        {adicionandoId === j.id ? "..." : "Adicionar"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {times.length > 0 && (
            <div className={ss.timesGrid}>
              {times.map(time => (
                <div key={time.label} className={ss.timeCard}>
                  <div className={ss.timeHeader}>
                    <span className={ss.timeLabel}>{time.label}</span>
                    <span className={ss.timeMedia}>⭐ {mediaRating(time.jogadores)}</span>
                  </div>
                  <ul className={ss.timeList}>
                    {time.jogadores.map((j, i) => (
                      <li key={i} className={ss.timeItem}>
                        <div className={ss.itemAvatar}>{j.nome[0].toUpperCase()}</div>
                        <span className={ss.itemNome}>{j.nome}</span>
                        <span className={ss.itemRating}>{j.rating}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {times.length === 0 && !erro && totalParaSortear >= MIN_CONFIRMADOS && (
            <div className={ss.hint}>
              Clique em "Sortear times" para gerar os times balanceados com os {totalParaSortear} jogadores.
            </div>
          )}
        </>
      )}
    </div>
  )
}
