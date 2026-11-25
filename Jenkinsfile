pipeline {
    agent any
    options {
        skipDefaultCheckout(true)
        timeout(time: 20, unit: 'MINUTES')
    }
    environment {
        SONAR_PROJECT_KEY = 'student-services-platform999998888889999988'
    }
    stages {
        stage('Checkout') {
            steps { checkout scm }
        }
        stage('Build, test and measure coverage') {
            steps { sh 'mvn --batch-mode -f pm2-java/pom.xml clean verify' }
            post {
                always {
                    junit testResults: 'pm2-java/target/surefire-reports/TEST-*.xml', allowEmptyResults: true
                    archiveArtifacts artifacts: 'pm2-java/target/surefire-reports/**, pm2-java/target/site/jacoco/**', allowEmptyArchive: true
                }
            }
        }
        stage('Analyze and enforce SonarQube quality gate') {
            steps {
                script {
                    if (env.SONAR_HOST_URL?.trim()) {
                        withCredentials([string(credentialsId: 'pm2-sonar-token', variable: 'SONAR_TOKEN')]) {
                            sh 'scripts/pm2/quality-gate.sh'
                        }
                    } else {
                        sh 'bash scripts/pm2/quality-gate-ci.sh'
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'pm2-java/target/sonar-quality-gate.json', allowEmptyArchive: true
                }
            }
        }
    }
}
