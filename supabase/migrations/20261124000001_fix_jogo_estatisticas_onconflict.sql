-- O upsert do frontend usa onConflict: "jogo_id,jogador_id" / "jogo_id,presenca_id"
-- sem cláusula WHERE, mas os índices únicos existentes eram parciais
-- (WHERE jogador_id IS NOT NULL / WHERE presenca_id IS NOT NULL). O Postgres não
-- consegue inferir um índice parcial como alvo do ON CONFLICT sem repetir o
-- predicado na própria query, e o PostgREST não envia esse predicado — resultado:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
-- Trocando para índices únicos completos (não parciais) o problema desaparece:
-- NULL nunca colide com NULL em índice único, então várias linhas de convidado
-- (jogador_id NULL) e várias linhas de jogador (presenca_id NULL) continuam
-- coexistindo sem violar a unicidade.
DROP INDEX IF EXISTS public.jogo_estat_jogador_idx;
DROP INDEX IF EXISTS public.jogo_estat_presenca_idx;

CREATE UNIQUE INDEX IF NOT EXISTS jogo_estat_jogador_idx ON public.jogo_estatisticas (jogo_id, jogador_id);
CREATE UNIQUE INDEX IF NOT EXISTS jogo_estat_presenca_idx ON public.jogo_estatisticas (jogo_id, presenca_id);
