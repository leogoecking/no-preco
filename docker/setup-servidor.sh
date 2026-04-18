#!/usr/bin/env bash
# Script de setup do servidor para deploy via CI/CD
# Execute como root: bash setup-servidor.sh

set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/opt/no-preco"
PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG3EqtIHqBlUtiSzYL2XlKODCN7CKJTQSzTXK022qwR9 github-actions-no-preco"

echo "==> Criando usuário $DEPLOY_USER..."
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi

echo "==> Adicionando $DEPLOY_USER ao grupo docker..."
usermod -aG docker "$DEPLOY_USER"

echo "==> Configurando chave SSH autorizada..."
SSH_DIR="/home/$DEPLOY_USER/.ssh"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
echo "$PUBLIC_KEY" >> "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR"

echo "==> Criando diretório da aplicação em $APP_DIR..."
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo ""
echo "==> Setup concluído."
echo ""
echo "Próximos passos:"
echo "  1. Copie o docker-compose.yml e o .env para $APP_DIR"
echo "  2. Adicione os secrets no GitHub conforme instruções"
