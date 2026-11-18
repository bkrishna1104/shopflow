{{/* Service name: required, used for every object name and the DNS name. */}}
{{- define "microservice.name" -}}
{{- required "values.name is required (e.g. user-service)" .Values.name -}}
{{- end -}}

{{/* Labels used to SELECT pods. Must never change after first install. */}}
{{- define "microservice.selectorLabels" -}}
app.kubernetes.io/name: {{ include "microservice.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Full label set (selector labels + descriptive labels). */}}
{{- define "microservice.labels" -}}
{{ include "microservice.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/part-of: shopflow
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "microservice.image" -}}
{{ required "values.image.repository is required" .Values.image.repository }}:{{ required "values.image.tag is required" .Values.image.tag }}
{{- end -}}
