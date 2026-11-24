-- "Menos vazado" deve considerar só quem de fato já foi ao gol: goleiros
-- (jogadores.posicao = 'goleiro') ou jogadores de linha que já tomaram gol em
-- algum jogo (gols_sofridos > 0 em algum lançamento), o que é o sinal que temos
-- de que a pessoa esteve no gol. Sem isso, um jogador de linha que nunca jogou
-- no gol aparecia como "menos vazado" só por ter 0 sofridos.
CREATE OR REPLACE FUNCTION public.lideranca_publica(p_patota_id integer)
RETURNS TABLE (
  categoria  text,
  nome       text,
  total      integer,
  jogos      integer,
  media      numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      je.jogador_id,
      jg.nome,
      jg.posicao,
      COUNT(*)::int                   AS n_jogos,
      SUM(je.gols)::int               AS gols,
      SUM(je.gols_sofridos)::int      AS gols_sofridos,
      SUM(je.canetas)::int            AS canetas,
      BOOL_OR(je.gols_sofridos > 0)   AS ja_foi_ao_gol
    FROM public.jogo_estatisticas je
    JOIN public.jogos jj ON jj.id = je.jogo_id
    JOIN public.jogadores jg ON jg.id = je.jogador_id
    WHERE jj.patota_id = p_patota_id
      AND je.jogador_id IS NOT NULL
    GROUP BY je.jogador_id, jg.nome, jg.posicao
  ),
  artilheiro AS (
    SELECT nome, gols AS total, n_jogos,
           ROUND(gols::numeric / NULLIF(n_jogos, 0), 2) AS media
    FROM stats ORDER BY media DESC NULLS LAST, nome LIMIT 1
  ),
  menos_vazado AS (
    SELECT nome, gols_sofridos AS total, n_jogos,
           ROUND(gols_sofridos::numeric / NULLIF(n_jogos, 0), 2) AS media
    FROM stats
    WHERE posicao = 'goleiro' OR ja_foi_ao_gol
    ORDER BY media ASC NULLS LAST, nome LIMIT 1
  ),
  mais_coca AS (
    SELECT nome, canetas AS total, n_jogos,
           ROUND(canetas::numeric / NULLIF(n_jogos, 0), 2) AS media
    FROM stats ORDER BY media DESC NULLS LAST, nome LIMIT 1
  )
  SELECT 'artilheiro'::text,   a.nome, a.total, a.n_jogos, a.media FROM artilheiro a
  UNION ALL
  SELECT 'menos_vazado'::text, v.nome, v.total, v.n_jogos, v.media FROM menos_vazado v
  UNION ALL
  SELECT 'mais_coca'::text,    c.nome, c.total, c.n_jogos, c.media FROM mais_coca c;
END;
$$;
