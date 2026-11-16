-- sortear_times: distribui goleiros entre os times antes dos demais jogadores.
-- Cada pessoa vai para o time com menos goleiros (se for goleiro), depois com
-- menos jogadores, depois com menor soma de notas.
CREATE OR REPLACE FUNCTION public.sortear_times(
  p_jogo_id uuid,
  p_num_times integer DEFAULT NULL
)
RETURNS TABLE(
  time_label text,
  jogador_id uuid,
  convidado_id uuid,
  nome text,
  rating integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_patota_id integer;
  v_pessoa    record;
  v_labels    text[] := array['A','B','C','D','E','F'];
  v_total     int;
  v_num_times int;
  v_cnt       int[];
  v_soma      int[];
  v_gols      int[];
  v_melhor    int;
  i           int;
BEGIN
  SELECT g.patota_id INTO v_patota_id
  FROM public.jogos g WHERE g.id = p_jogo_id;

  IF v_patota_id IS NULL THEN
    RAISE EXCEPTION 'jogo não encontrado';
  END IF;

  IF NOT (SELECT public.is_patota_admin(v_patota_id)) THEN
    RAISE EXCEPTION 'apenas admin pode sortear times';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.presencas p
  WHERE p.jogo_id = p_jogo_id
    AND p.confirmado = true
    AND (p.convidado = false OR p.convidado IS NULL OR p.aprovado = true);

  v_num_times := LEAST(6, GREATEST(2, COALESCE(
    p_num_times,
    ROUND(v_total::numeric / 5)::int
  )));

  v_cnt  := array_fill(0, ARRAY[v_num_times]);
  v_soma := array_fill(0, ARRAY[v_num_times]);
  v_gols := array_fill(0, ARRAY[v_num_times]);

  DELETE FROM public.sorteio_times WHERE sorteio_times.jogo_id = p_jogo_id;

  FOR v_pessoa IN
    SELECT * FROM (
      SELECT
        p.jogador_id                       AS jid,
        NULL::uuid                         AS cid,
        COALESCE(j.nota, 3)::int           AS rating,
        j.nome                             AS nome,
        (j.posicao = 'goleiro')            AS goleiro
      FROM public.presencas p
      JOIN public.jogadores j ON j.id = p.jogador_id
      WHERE p.jogo_id = p_jogo_id
        AND p.confirmado = true
        AND (p.convidado = false OR p.convidado IS NULL)
      UNION ALL
      SELECT
        NULL::uuid,
        p.id,
        COALESCE(p.rating_convidado, p.rating_habilidade, 3)::int,
        COALESCE(p.nome_convidado, 'Convidado'),
        (COALESCE(p.posicao_convidado, p.posicao) = 'goleiro')
      FROM public.presencas p
      WHERE p.jogo_id = p_jogo_id
        AND p.confirmado = true
        AND p.convidado = true
        AND p.aprovado = true
    ) sub
    ORDER BY COALESCE(sub.goleiro, false) DESC, sub.rating DESC, random()
  LOOP
    v_melhor := 1;
    FOR i IN 2..v_num_times LOOP
      IF COALESCE(v_pessoa.goleiro, false) THEN
        IF ROW(v_gols[i], v_cnt[i], v_soma[i]) < ROW(v_gols[v_melhor], v_cnt[v_melhor], v_soma[v_melhor]) THEN
          v_melhor := i;
        END IF;
      ELSIF ROW(v_cnt[i], v_soma[i]) < ROW(v_cnt[v_melhor], v_soma[v_melhor]) THEN
        v_melhor := i;
      END IF;
    END LOOP;

    v_cnt[v_melhor]  := v_cnt[v_melhor] + 1;
    v_soma[v_melhor] := v_soma[v_melhor] + v_pessoa.rating;
    IF COALESCE(v_pessoa.goleiro, false) THEN
      v_gols[v_melhor] := v_gols[v_melhor] + 1;
    END IF;

    INSERT INTO public.sorteio_times (jogo_id, patota_id, time_label, jogador_id, convidado_id, nome, rating)
    VALUES (p_jogo_id, v_patota_id, v_labels[v_melhor], v_pessoa.jid, v_pessoa.cid, v_pessoa.nome, v_pessoa.rating);

    time_label   := v_labels[v_melhor];
    jogador_id   := v_pessoa.jid;
    convidado_id := v_pessoa.cid;
    nome         := v_pessoa.nome;
    rating       := v_pessoa.rating;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;
