pipeline {
    agent any
    options {
        skipDefaultCheckout(true)
        timeout(time: 20, unit: 'MINUTES')
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
                    archiveArtifacts artifacts: 'pm2-java/target/site/jacoco/**', allowEmptyArchive: true
                }
            }
        }
        stage('SonarQube quality gate') {
            steps {
                withCredentials([string(credentialsId: 'pm2-sonar-token', variable: 'SONAR_TOKEN')]) {
                    sh 'scripts/pm2/quality-gate.sh'
                }
            }
        }
    }
}
