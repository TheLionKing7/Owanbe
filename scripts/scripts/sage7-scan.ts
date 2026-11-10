# Sage 7 scan command. The token comes from the environment (SAGE7_TOKEN); never commit it.
node --experimental-strip-types scripts/sage7-scan.ts \
  --token "$SAGE7_TOKEN" \
  --api-url https://sage7.dev \
  --target "thelionking7/owanbe"
