-- "presencas: self insert/update" validavam o vínculo só por e-mail
-- (jogadores.email = usuarios.email), mas muitos jogadores não têm email
-- preenchido na própria ficha — o vínculo real é usuario_id. Resultado:
-- usuário logado, com jogador corretamente vinculado por usuario_id, tinha o
-- INSERT/UPDATE de presenca rejeitado pela RLS ("new row violates row-level
-- security policy"). Agora a policy aceita qualquer uma das duas formas de
-- vínculo.
DROP POLICY IF EXISTS "presencas: self insert" ON presencas;
CREATE POLICY "presencas: self insert" ON presencas
  FOR INSERT WITH CHECK (
    jogador_id IS NULL   -- flow de convidado por nome
    OR (
      auth.uid() IS NOT NULL
      AND jogador_id IN (
        SELECT j.id FROM jogadores j
        WHERE j.usuario_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM usuarios u
             WHERE u.id = auth.uid() AND lower(u.email) = lower(j.email)
           )
      )
    )
    OR EXISTS (
      SELECT 1 FROM jogos jo
      WHERE jo.id = jogo_id
      AND public.is_patota_admin(jo.patota_id)
    )
  );

DROP POLICY IF EXISTS "presencas: self update" ON presencas;
CREATE POLICY "presencas: self update" ON presencas
  FOR UPDATE USING (
    auth.uid() IS NOT NULL
    AND jogador_id IN (
      SELECT j.id FROM jogadores j
      WHERE j.usuario_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM usuarios u
           WHERE u.id = auth.uid() AND lower(u.email) = lower(j.email)
         )
    )
  );
