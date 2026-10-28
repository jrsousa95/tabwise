import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useEstablishment, updateEstablishmentSettings } from "../lib/closing";
import { MULTI_TERMINAL_UI_ENABLED } from "../lib/feature-flags";
import { defineMessages, useMessages } from "../lib/i18n";

const messages = defineMessages({
  pt: {
    loading: "Carregando...",
    title: "Configurações do estabelecimento",
    serviceFeeHeading: "Taxa de serviço padrão",
    serviceFeePlaceholder: "Ex: 10",
    serviceFeeAriaLabel: "Taxa de serviço padrão (%)",
    save: "Salvar",
    serviceFeeSaved: "Taxa de serviço padrão atualizada.",
    pairingHeading: "Pareamento de terminais",
    pairingHint: "Conecte este terminal a outro já configurado na mesma rede pra sincronizar mesas, cardápio e operadores.",
    configurePairing: "Configurar pareamento →",
  },
  en: {
    loading: "Loading...",
    title: "Venue settings",
    serviceFeeHeading: "Default service charge",
    serviceFeePlaceholder: "e.g. 10",
    serviceFeeAriaLabel: "Default service charge (%)",
    save: "Save",
    serviceFeeSaved: "Default service charge updated.",
    pairingHeading: "Terminal pairing",
    pairingHint: "Connect this terminal to another one already set up on the same network to sync tables, menu and staff.",
    configurePairing: "Set up pairing →",
  },
});

/**
 * Configurações gerais do estabelecimento (dono). Antes vivia dentro de
 * Cardápio, empurrando Categorias/Produtos pra baixo com uma seção inteira
 * de topo pra uma configuração raramente alterada — ganhou página própria
 * (achado em uso real, 2026-09-22).
 */
function EstablishmentSettings() {
  const m = useMessages(messages);
  const { status, defaultServiceFeePercent, refresh } = useEstablishment();

  const [serviceFeePercent, setServiceFeePercent] = useState("10");
  const [serviceFeeError, setServiceFeeError] = useState<string | null>(null);
  const [serviceFeeSubmitting, setServiceFeeSubmitting] = useState(false);
  const [serviceFeeSaved, setServiceFeeSaved] = useState(false);

  useEffect(() => {
    if (status === "ready") setServiceFeePercent(String(defaultServiceFeePercent));
  }, [status, defaultServiceFeePercent]);

  async function handleSaveServiceFee(e: React.FormEvent) {
    e.preventDefault();
    const percent = Number(serviceFeePercent.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || serviceFeeSubmitting) return;
    setServiceFeeSubmitting(true);
    setServiceFeeError(null);
    setServiceFeeSaved(false);
    const result = await updateEstablishmentSettings(percent);
    setServiceFeeSubmitting(false);
    if (!result.ok) {
      setServiceFeeError(result.error);
      return;
    }
    setServiceFeeSaved(true);
    refresh();
  }

  if (status === "loading") {
    return (
      <section>
        <p>{m.loading}</p>
      </section>
    );
  }

  return (
    <section>
      <h1>{m.title}</h1>
      <div className="table-map-section settings-section">
        <h2 className="section-heading">{m.serviceFeeHeading}</h2>
        {/* Achado em uso real, 2026-09-22: era o único `.inline-form` do app
            com um `<label>` de legenda visível empilhada sobre o input — o
            bloco label+input ficava bem mais alto que o botão ao lado, que
            centralizava contra a altura toda (legenda incluída) em vez de
            contra o input, lendo como desalinhado. Todo outro
            `.inline-form` do app já usa placeholder/aria-label (sem
            legenda empilhada) por esse motivo — só padronizando aqui. */}
        <form onSubmit={handleSaveServiceFee} className="inline-form">
          <input
            value={serviceFeePercent}
            onChange={(e) => {
              setServiceFeePercent(e.target.value.replace(/[^0-9,.]/g, ""));
              setServiceFeeSaved(false);
            }}
            inputMode="decimal"
            placeholder={m.serviceFeePlaceholder}
            aria-label={m.serviceFeeAriaLabel}
          />
          <button type="submit" className="button-primary" disabled={serviceFeeSubmitting}>
            {m.save}
          </button>
        </form>
        {serviceFeeError && <p className="form-error" role="alert">{serviceFeeError}</p>}
        {serviceFeeSaved && <p>{m.serviceFeeSaved}</p>}
      </div>

      {/* Achado em uso real, 2026-09-22: Pareamento também é ação
          administrativa rara — saiu do menu principal (mesmo motivo da
          Taxa de serviço) e mora aqui como link. Rota /pairing continua
          própria e fora do shell autenticado (não muda): é o único fluxo
          que também atende terminal novo, sem nenhum operador
          cadastrado ainda, então não pode depender de login pra ser
          alcançado. Escondido enquanto MULTI_TERMINAL_UI_ENABLED for false
          (feature-flags.ts) — ver ali o motivo. */}
      {MULTI_TERMINAL_UI_ENABLED && (
        <div className="table-map-section">
          <h2 className="section-heading">{m.pairingHeading}</h2>
          <p>{m.pairingHint}</p>
          <Link to="/pairing" className="button-secondary">
            {m.configurePairing}
          </Link>
        </div>
      )}
    </section>
  );
}

export default EstablishmentSettings;
