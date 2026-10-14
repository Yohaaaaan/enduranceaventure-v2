#!/usr/bin/env bash
set -e

SERVER_IP="79.72.24.207"
DOMAIN="enduranceaventure.com"
WWW_DOMAIN="www.enduranceaventure.com"
EMAIL="contact@enduranceaventure.com"

echo "=== Vérification DNS pour ${DOMAIN} ==="
CURRENT_IP=$(dig +short @8.8.8.8 ${DOMAIN} | tail -n1)
CURRENT_WWW_IP=$(dig +short @8.8.8.8 ${WWW_DOMAIN} | tail -n1)

echo "IP actuelle domaine principal (@8.8.8.8) : ${CURRENT_IP:-non résolu}"
echo "IP actuelle sous-domaine www (@8.8.8.8)    : ${CURRENT_WWW_IP:-non résolu}"
echo "IP cible de ce serveur                   : ${SERVER_IP}"

if [ "${CURRENT_IP}" != "${SERVER_IP}" ]; then
  echo ""
  echo "⚠️ La propagation DNS n'est pas encore terminée (ou la zone DNS OVH n'a pas encore été mise à jour)."
  echo "Veuillez configurer sur OVH :"
  echo "  - Type A : ${DOMAIN} -> ${SERVER_IP}"
  echo "  - Type A : ${WWW_DOMAIN} -> ${SERVER_IP}"
  echo "Dès que dig renvoie ${SERVER_IP}, relancez ce script avec : sudo bash /mnt/data/enduranceaventure-v2/scripts/activate_ssl.sh"
  exit 1
fi

echo ""
echo "✅ DNS vérifié ! L'IP pointe bien vers ce serveur (${SERVER_IP})."
echo "Obtention du certificat SSL Let's Encrypt..."

sudo certbot --nginx -d ${DOMAIN} -d ${WWW_DOMAIN} --redirect --agree-tos --email ${EMAIL} --non-interactive

echo "✅ Certificat SSL activé avec succès !"
sudo systemctl reload nginx
echo "Site sécurisé en HTTPS sur https://${DOMAIN}/ et https://${WWW_DOMAIN}/"
