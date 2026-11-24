-- "Menos vazado" deve considerar só quem de fato já foi ao gol: goleiros
-- (jogadores.posicao = 'goleiro') ou jogadores de linha que já tomaram gol em
-- algum jogo (gols_sofridos > 0 em algum lançamento), o que é o sinal que temos
-- de que a pessoa esteve no gol. Sem isso, um jogador de linha que nunca jogou
-- no gol aparecia como "menos vazado" só por ter 0 sofridos.
--
-- Os nomes de coluna dentro da função evitam "nome"/"total"/"jogos"/"media"
-- porque esses também são nomes dos parâmetros OUT de RETURNS TABLE: usar o
-- mesmo nome (mesmo qualificado com alias de tabela) faz o Postgres não saber
-- se a referência é a coluna da CTE ou a variável plpgsql, e falha com
-- "column reference ... is ambiguous". Prefixando com v_ o problema desaparece.
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
      je.jogador_id                   AS v_jogador_id,
      jg.nome                         AS v_nome,
      jg.posicao                      AS v_posicao,
      COUNT(*)::int                   AS v_n_jogos,
      SUM(je.gols)::int               AS v_gols,
      SUM(je.gols_sofridos)::int      AS v_gols_sofridos,
      SUM(je.canetas)::int            AS v_canetas,
      BOOL_OR(je.gols_sofridos > 0)   AS v_ja_foi_ao_gol
    FROM public.jogo_estatisticas je
    JOIN public.jogos jj ON jj.id = je.jogo_id
    JOIN public.jogadores jg ON jg.id = je.jogador_id
    WHERE jj.patota_id = p_patota_id
      AND je.jogador_id IS NOT NULL
    GROUP BY je.jogador_id, jg.nome, jg.posicao
  ),
  artilheiro AS (
    SELECT v_nome AS v_nome, v_gols AS v_total, v_n_jogos AS v_n_jogos,
           ROUND(v_gols::numeric / NULLIF(v_n_jogos, 0), 2) AS v_media
    FROM stats ORDER BY v_media DESC NULLS LAST, v_nome LIMIT 1
  ),
  menos_vazado AS (
    SELECT v_nome AS v_nome, v_gols_sofridos AS v_total, v_n_jogos AS v_n_jogos,
           ROUND(v_gols_sofridos::numeric / NULLIF(v_n_jogos, 0), 2) AS v_media
    FROM stats
    WHERE v_posicao = 'goleiro' OR v_ja_foi_ao_gol
    ORDER BY v_media ASC NULLS LAST, v_nome LIMIT 1
  ),
  mais_coca AS (
    SELECT v_nome AS v_nome, v_canetas AS v_total, v_n_jogos AS v_n_jogos,
           ROUND(v_canetas::numeric / NULLIF(v_n_jogos, 0), 2) AS v_media
    FROM stats ORDER BY v_media DESC NULLS LAST, v_nome LIMIT 1
  )
  SELECT 'artilheiro'::text,   v_nome, v_total, v_n_jogos, v_media FROM artilheiro
  UNION ALL
  SELECT 'menos_vazado'::text, v_nome, v_total, v_n_jogos, v_media FROM menos_vazado
  UNION ALL
  SELECT 'mais_coca'::text,    v_nome, v_total, v_n_jogos, v_media FROM mais_coca;
END;
$$;
