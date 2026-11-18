// =============================================================================
// ShopFlow CI pipeline (Phase 4)
//
//   Version -> Unit tests (6 services in parallel) -> SonarCloud quality gate
//           -> Build images -> Trivy security gate
//
// Runs as a Jenkins *Multibranch Pipeline*: Jenkins finds every branch / PR / tag
// that contains this file and runs it. The result is reported back to GitHub as a
// commit status, and the branch ruleset blocks merging until it is green.
//
// Every tool runs in a pinned container image, so the Jenkins VM only needs
// Docker + Trivy. Changing a tool version = changing one line here, in Git.
// =============================================================================

// Adding a 7th service later = add one entry here.
def SERVICES = ['user-service', 'product-service', 'order-service',
                'payment-service', 'notification-service', 'web-ui']

pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')               // a hung build must not block the queue forever
    buildDiscarder(logRotator(numToKeepStr: '20'))   // keep disk usage bounded
    disableConcurrentBuilds(abortPrevious: true)     // new push to a PR cancels the outdated build
  }

  environment {
    NODE_IMAGE          = 'node:24-alpine'
    SONAR_SCANNER_IMAGE = 'sonarsource/sonar-scanner-cli:11'
  }

  stages {

    // One version string per build, used for image tags, APP_VERSION and Sonar.
    //   tag v1.2.0 -> 1.2.0 | branch develop -> develop-a1b2c3d | PR #12 -> pr-12-a1b2c3d
    stage('Version') {
      steps {
        script {
          def sha = sh(script: 'git rev-parse --short=7 HEAD', returnStdout: true).trim()
          env.VERSION = env.TAG_NAME
            ? env.TAG_NAME.replaceFirst(/^v/, '')
            : "${env.BRANCH_NAME.toLowerCase().replaceAll(/[^a-z0-9.]+/, '-')}-${sha}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.VERSION}"
          echo "Building version ${env.VERSION}"
        }
      }
    }

    // npm ci + npm test for each service, in parallel, inside node:24-alpine.
    // Produces coverage/lcov.info (for SonarCloud) and coverage/junit.xml (for Jenkins).
    stage('Unit tests') {
      steps {
        script {
          def branches = [:]
          for (s in SERVICES) {
            def svc = s   // capture per iteration, otherwise every branch sees the last value
            branches[svc] = {
              // The container runs as the jenkins user, which has no writable home
              // directory inside the image, so point npm's cache at /tmp.
              docker.image(env.NODE_IMAGE).inside('-e npm_config_cache=/tmp/.npm') {
                dir("services/${svc}") {
                  sh 'npm ci --no-audit --no-fund'
                  sh 'npm test -- --test-reporter=junit --test-reporter-destination=coverage/junit.xml'
                  // lcov paths are relative to the service (SF:src/app.js). SonarCloud
                  // analyses the whole repo, so make them repo-relative.
                  sh "sed -i 's#^SF:#SF:services/${svc}/#' coverage/lcov.info"
                }
              }
            }
          }
          parallel branches
        }
      }
      post {
        always { junit allowEmptyResults: true, testResults: 'services/*/coverage/junit.xml' }
      }
    }

    // SonarCloud: code quality + coverage. qualitygate.wait=true makes the scanner
    // POLL SonarCloud for the verdict, so no inbound webhook to your home network.
    // Skipped for tag builds: the same commit was already analysed on main.
    stage('SonarCloud') {
      when { anyOf { changeRequest(); branch 'main' } }
      steps {
        withCredentials([string(credentialsId: 'sonarcloud-token', variable: 'SONAR_TOKEN')]) {
          script {
            def args = ["-Dsonar.projectVersion=${env.VERSION}",
                        '-Dsonar.qualitygate.wait=true',
                        '-Dsonar.qualitygate.timeout=300']
            if (env.CHANGE_ID) {   // this build is a pull request
              args += ["-Dsonar.pullrequest.key=${env.CHANGE_ID}",
                       "-Dsonar.pullrequest.branch=${env.CHANGE_BRANCH}",
                       "-Dsonar.pullrequest.base=${env.CHANGE_TARGET}"]
            } else {
              args += ["-Dsonar.branch.name=${env.BRANCH_NAME}"]
            }
            // SONAR_TOKEN is read from the environment by the scanner, never printed.
            docker.image(env.SONAR_SCANNER_IMAGE).inside('--entrypoint= -e SONAR_USER_HOME=/tmp/.sonar') {
              sh "sonar-scanner ${args.join(' ')}"
            }
          }
        }
      }
    }

    // Build the 6 images. --pull = always start from the latest patched base image.
    // Images stay on this VM for now; Phase 7 pushes them to AWS ECR.
    stage('Build images') {
      steps {
        script {
          def revision = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          SERVICES.each { svc ->
            sh """
              docker build --pull \
                --build-arg APP_VERSION=${env.VERSION} \
                --label org.opencontainers.image.revision=${revision} \
                -t shopflow/${svc}:${env.VERSION} \
                services/${svc}
            """
          }
        }
      }
    }

    // Trivy security gate (diagram box 3: "Fail on High/Critical").
    //  - Full report of every severity is archived for reading.
    //  - Gate fails only on HIGH/CRITICAL that HAVE a fix (--ignore-unfixed).
    //  - Accepted risks go in .trivyignore with a reason and an expiry date.
    stage('Trivy scan') {
      steps {
        script {
          def failed = []
          SERVICES.each { svc ->
            def image = "shopflow/${svc}:${env.VERSION}"
            sh "trivy image --no-progress --scanners vuln,secret --format table --output trivy-${svc}.txt ${image}"
            def rc = sh(returnStatus: true, script: """
              trivy image --no-progress --scanners vuln,secret \
                --severity HIGH,CRITICAL --ignore-unfixed \
                --ignorefile .trivyignore --exit-code 1 ${image}
            """)
            if (rc != 0) { failed << svc }
          }
          if (failed) {
            error "Trivy found fixable HIGH/CRITICAL issues in: ${failed.join(', ')} (see trivy-*.txt artifacts)"
          }
        }
      }
      post {
        always { archiveArtifacts artifacts: 'trivy-*.txt', allowEmptyArchive: true }
      }
    }
  }

  post {
    success { echo "✅ ${env.VERSION}: tests, quality gate and security gate passed" }
    always {
      // Housekeeping so the 60 GB disk doesn't fill up: remove our images older than 3 days.
      sh '''docker image prune -af --filter "until=72h" \
              --filter "label=org.opencontainers.image.source=https://github.com/bkrishna1104/shopflow" || true'''
      cleanWs(deleteDirs: true, notFailBuild: true)
    }
  }
}