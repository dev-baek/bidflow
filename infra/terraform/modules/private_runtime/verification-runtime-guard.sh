check_verification_runtime_env() {
  if ! LC_ALL=C awk -F= '
    {
      key = $1
      if (NR == 1) sub(/^\357\273\277/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      gsub(/[.-]/, "_", key)
      key = toupper(key)
      if (key ~ /^(BIDFLOW_COGNITO_ISSUER_?URI|BIDFLOW_COGNITO_CLIENT_?ID|BIDFLOW_VERIFICATION_WEB_?ORIGIN|SPRING_APPLICATION_JSON|SPRING_PROFILES_.*|SPRING_CONFIG_.*|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS)$/)
        exit 1
    }
  ' "$1"; then
    printf '%s\n' 'Runtime Secret must not override managed verification settings.' >&2
    return 1
  fi
}
